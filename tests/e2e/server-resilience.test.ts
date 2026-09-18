import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { jsonResponse, type ApiHandler } from '../../src/interface/http/api.ts'
import { startHttpServer, type RunningServer } from '../../src/interface/http/server.ts'
import { silentLogger, type Logger } from '../../src/observability/logger.ts'

/**
 * Le transport ne doit jamais pouvoir tuer le processus.
 *
 * Si l'une de ces situations faisait tomber le serveur, le processus de test
 * mourrait avec lui : arriver au bout du fichier fait partie de l'assertion.
 */

const explodingHandler: ApiHandler = () => Promise.reject(new Error('bug dans un endpoint'))

const explodingLogger: Logger = {
  log: () => {
    // Cas reel : EPIPE sur stdout, ou collecteur de logs indisponible.
    throw new Error('EPIPE: le puits de logs est tombe')
  },
}

const request = (server: RunningServer, path: string) =>
  fetch(`http://127.0.0.1:${server.port}${path}`)

describe('resilience du transport HTTP', () => {
  describe('un endpoint qui leve', () => {
    let server: RunningServer

    before(async () => {
      server = await startHttpServer({ handler: explodingHandler, port: 0, logger: silentLogger })
    })
    after(() => server.close())

    it('repond 500 sans divulguer la cause', async () => {
      const response = await request(server, '/weather?address=Ales')
      const body = (await response.json()) as { title: string; detail: string }

      assert.equal(response.status, 500)
      assert.equal(response.headers.get('content-type'), 'application/problem+json; charset=utf-8')
      assert.equal(body.title, 'Erreur interne')
      assert.doesNotMatch(body.detail, /bug dans un endpoint/u, 'aucune fuite de detail interne')
    })

    it('continue de servir les requetes suivantes', async () => {
      assert.equal((await request(server, '/health')).status, 500)
      assert.equal((await request(server, '/autre')).status, 500)
    })
  })

  describe('un logger qui leve', () => {
    let server: RunningServer

    it('n empeche pas le serveur de demarrer', async () => {
      server = await startHttpServer({ handler: explodingHandler, port: 0, logger: explodingLogger })

      assert.ok(server.port > 0)
    })
    after(() => server.close())

    it('ne fait pas tomber le processus sur le chemin d erreur', async () => {
      const response = await request(server, '/weather?address=Ales')

      assert.equal(response.status, 500, 'le client doit quand meme obtenir une reponse')
    })

    it('laisse le serveur repondre aux requetes suivantes', async () => {
      assert.equal((await request(server, '/health')).status, 500)
    })
  })

  describe('un logger qui leve, avec un endpoint sain', () => {
    let server: RunningServer

    before(async () => {
      server = await startHttpServer({
        handler: () => Promise.resolve(jsonResponse(200, { ok: true })),
        port: 0,
        logger: explodingLogger,
      })
    })
    after(() => server.close())

    it('sert normalement : la journalisation est accessoire', async () => {
      const response = await request(server, '/peu-importe')

      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { ok: true })
    })
  })
})
