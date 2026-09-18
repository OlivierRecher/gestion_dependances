import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { startTestServer, type TestServer } from '../support/test-server.ts'
import { networkError, respond, timeout, OPEN_METEO_BODY } from '../support/fake-upstreams.ts'

describe('API meteo (bout en bout)', () => {
  describe('chemin nominal', () => {
    let server: TestServer

    before(async () => {
      server = await startTestServer()
    })
    after(() => server.close())

    it('renvoie les previsions du lieu demande', async () => {
      const response = await server.get('/weather?address=Ales')

      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
      assert.deepEqual(response.body, {
        address: 'Ales',
        location: {
          label: 'Ales, Gard, Occitanie, France',
          latitude: 44.1281,
          longitude: 4.0817,
        },
        forecast: {
          timezone: 'GMT',
          hourly: [
            { time: '2026-09-18T00:00', shortwaveRadiation: 0 },
            { time: '2026-09-18T12:00', shortwaveRadiation: 512.4 },
          ],
        },
        meta: {
          degraded: false,
          sources: { geocoding: 'live', forecast: 'live' },
        },
      })
    })

    it('a bien enchaine les deux services externes', () => {
      assert.equal(server.upstreams.geocoding.calls, 1)
      assert.equal(server.upstreams.forecast.calls, 1)
    })

    it('expose une sonde de sante', async () => {
      const response = await server.get('/health')

      assert.equal(response.status, 200)
      assert.deepEqual(response.body, {
        status: 'ok',
        dependencies: [
          { name: 'nominatim', dependency: 'geocoding', circuit: 'closed', healthy: true },
          { name: 'open-meteo', dependency: 'forecast', circuit: 'closed', healthy: true },
        ],
      })
    })
  })

  describe('requetes invalides', () => {
    let server: TestServer

    before(async () => {
      server = await startTestServer()
    })
    after(() => server.close())

    it('refuse une requete sans adresse', async () => {
      const response = await server.get('/weather')

      assert.equal(response.status, 400)
      assert.equal(response.headers.get('content-type'), 'application/problem+json; charset=utf-8')
      assert.equal(server.upstreams.geocoding.calls, 0)
    })

    it('rend 404 sur une route inconnue', async () => {
      assert.equal((await server.get('/inconnu')).status, 404)
    })

    it('rend 404 quand le lieu est introuvable', async () => {
      server.upstreams.geocoding.reply = respond('[]')

      const response = await server.get('/weather?address=Atlantide')

      assert.equal(response.status, 404)
      assert.equal((response.body as { type: string }).type, 'urn:api-meteo:place-not-found')
    })
  })

  describe('mise en cache', () => {
    let server: TestServer

    before(async () => {
      server = await startTestServer()
    })
    after(() => server.close())

    it('ne sollicite les services externes qu une fois pour deux requetes identiques', async () => {
      await server.get('/weather?address=Ales')
      const response = await server.get('/weather?address=Ales')

      assert.equal(response.status, 200)
      assert.equal(server.upstreams.geocoding.calls, 1)
      assert.equal(server.upstreams.forecast.calls, 1)
      assert.deepEqual((response.body as { meta: { sources: unknown } }).meta.sources, {
        geocoding: 'cached',
        forecast: 'cached',
      })
    })

    it('rappelle les services une fois le TTL expire', async () => {
      server.clock.advance(60_000)

      await server.get('/weather?address=Ales')

      assert.equal(server.upstreams.geocoding.calls, 2)
      assert.equal(server.upstreams.forecast.calls, 2)
    })
  })

  describe('mode degrade : le service de previsions tombe', () => {
    let server: TestServer

    before(async () => {
      server = await startTestServer()
    })
    after(() => server.close())

    it('sert des previsions perimees plutot qu une erreur', async () => {
      await server.get('/weather?address=Ales')

      server.upstreams.forecast.reply = networkError()
      server.clock.advance(60_000)

      const response = await server.get('/weather?address=Ales')

      assert.equal(response.status, 200)
      assert.deepEqual((response.body as { meta: { sources: unknown; degraded: boolean } }).meta, {
        degraded: true,
        sources: { geocoding: 'live', forecast: 'stale' },
      })
      assert.match(response.headers.get('warning') ?? '', /^110 /)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    })

    it('ouvre le circuit et cesse d appeler le service en panne', async () => {
      const before = server.upstreams.forecast.calls

      server.clock.advance(60_000)
      await server.get('/weather?address=Ales')
      server.clock.advance(60_000)
      await server.get('/weather?address=Ales')

      assert.ok(server.upstreams.forecast.calls > before)
      const afterOpening = server.upstreams.forecast.calls

      server.clock.advance(60_000)
      await server.get('/weather?address=Ales')

      assert.equal(server.upstreams.forecast.calls, afterOpening, 'le circuit ouvert coupe les appels')
    })

    it('signale la degradation sur la sonde de sante sans tomber', async () => {
      const response = await server.get('/health')

      assert.equal(response.status, 200)
      const body = response.body as { status: string; dependencies: { name: string; healthy: boolean }[] }
      assert.equal(body.status, 'degraded')
      assert.equal(body.dependencies.find((d) => d.name === 'open-meteo')?.healthy, false)
      assert.equal(body.dependencies.find((d) => d.name === 'nominatim')?.healthy, true)
    })

    it('rend 503 avec le lieu resolu pour une adresse jamais vue', async () => {
      server.upstreams.geocoding.reply = respond(JSON.stringify([
        { lat: '43.8367', lon: '4.3601', display_name: 'Nimes, Gard, France' },
      ]))

      const response = await server.get('/weather?address=Nimes')

      assert.equal(response.status, 503)
      assert.equal(response.headers.get('content-type'), 'application/problem+json; charset=utf-8')
      assert.deepEqual(response.body, {
        type: 'urn:api-meteo:dependency-unavailable',
        title: 'Previsions indisponibles',
        status: 503,
        detail: 'Le service de previsions est indisponible (circuit ouvert apres des pannes repetees).',
        dependency: 'forecast',
        location: { label: 'Nimes, Gard, France', latitude: 43.8367, longitude: 4.3601 },
        meta: { degraded: true, sources: { geocoding: 'live', forecast: 'unavailable' } },
      })
    })

    it('se retablit tout seul quand le service revient', async () => {
      server.upstreams.forecast.reply = respond(OPEN_METEO_BODY)
      server.clock.advance(300_000)

      const response = await server.get('/weather?address=Nimes')

      assert.equal(response.status, 200)
      assert.deepEqual((response.body as { meta: { sources: { forecast: string } } }).meta.sources.forecast, 'live')
      assert.equal(((await server.get('/health')).body as { status: string }).status, 'ok')
    })
  })

  describe('mode degrade : le service de geocodage tombe', () => {
    let server: TestServer

    before(async () => {
      server = await startTestServer()
    })
    after(() => server.close())

    it('rend 503 pour une adresse inconnue du cache', async () => {
      server.upstreams.geocoding.reply = timeout()

      const response = await server.get('/weather?address=Ales')

      assert.equal(response.status, 503)
      assert.equal((response.body as { dependency: string }).dependency, 'geocoding')
      assert.equal(server.upstreams.forecast.calls, 0, 'inutile de solliciter la meteo sans coordonnees')
    })

    it('continue de repondre pour une adresse deja connue', async () => {
      server.upstreams.geocoding.reply = respond(JSON.stringify([
        { lat: '43.8367', lon: '4.3601', display_name: 'Nimes, Gard, France' },
      ]))
      await server.get('/weather?address=Nimes')

      server.upstreams.geocoding.reply = timeout()
      server.clock.advance(60_000)

      const response = await server.get('/weather?address=Nimes')

      assert.equal(response.status, 200)
      assert.equal(
        (response.body as { meta: { sources: { geocoding: string } } }).meta.sources.geocoding,
        'stale',
      )
    })

    it('garde la sonde de sante disponible', async () => {
      assert.equal((await server.get('/health')).status, 200)
    })
  })
})
