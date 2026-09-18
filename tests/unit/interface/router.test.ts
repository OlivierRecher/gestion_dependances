import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createRouter } from '../../../src/interface/http/router.ts'
import { jsonResponse, type ApiRequest } from '../../../src/interface/http/api.ts'

const request = (method: string, path: string): ApiRequest => ({ method, path, query: {} })

const router = createRouter([
  { method: 'GET', path: '/weather', handler: () => Promise.resolve(jsonResponse(200, 'meteo')) },
  { method: 'GET', path: '/health', handler: () => Promise.resolve(jsonResponse(200, 'sante')) },
])

describe('router', () => {
  it('route vers le handler correspondant', async () => {
    assert.equal((await router(request('GET', '/weather'))).body, 'meteo')
    assert.equal((await router(request('GET', '/health'))).body, 'sante')
  })

  it('rend 404 sur une route inconnue', async () => {
    const response = await router(request('GET', '/inconnu'))

    assert.equal(response.status, 404)
    assert.equal(response.headers['Content-Type'], 'application/problem+json; charset=utf-8')
  })

  it('rend 405 et annonce les methodes autorisees', async () => {
    const response = await router(request('POST', '/weather'))

    assert.equal(response.status, 405)
    assert.equal(response.headers['Allow'], 'GET')
  })

  it('traite HEAD comme GET', async () => {
    const response = await router(request('HEAD', '/weather'))

    assert.equal(response.status, 200)
  })

  it('ignore une barre oblique finale', async () => {
    assert.equal((await router(request('GET', '/weather/'))).status, 200)
  })

  it('ne confond pas deux chemins voisins', async () => {
    assert.equal((await router(request('GET', '/weatherxyz'))).status, 404)
  })
})
