import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createWeatherEndpoint } from '../../../src/interface/http/weather-endpoint.ts'
import { err, ok } from '../../../src/domain/result.ts'
import type { GetWeatherForAddress, WeatherReport } from '../../../src/application/get-weather-for-address.ts'
import type { ApiRequest } from '../../../src/interface/http/api.ts'
import { aForecast, anAddress, aPlace } from '../../support/fixtures.ts'

const request = (query: Record<string, string> = {}): ApiRequest => ({
  method: 'GET',
  path: '/weather',
  query,
})

const report = (overrides: Partial<WeatherReport> = {}): WeatherReport => ({
  address: anAddress('Ales'),
  place: aPlace(),
  forecast: aForecast(),
  degraded: false,
  sources: { geocoding: 'live', forecast: 'live' },
  ...overrides,
})

const endpointReturning = (answer: Awaited<ReturnType<GetWeatherForAddress>>) => {
  const calls: string[] = []
  const handler = createWeatherEndpoint((address) => {
    calls.push(address)
    return Promise.resolve(answer)
  })
  return { handler, calls }
}

describe('weatherEndpoint', () => {
  it('rend un rapport complet en 200', async () => {
    const { handler } = endpointReturning(ok(report()))

    const response = await handler(request({ address: 'Ales' }))

    assert.equal(response.status, 200)
    assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8')
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

  it('normalise l adresse avant de la transmettre au metier', async () => {
    const { handler, calls } = endpointReturning(ok(report()))

    await handler(request({ address: '  Ales   centre ' }))

    assert.deepEqual(calls, ['Ales centre'])
  })

  it('refuse une requete sans adresse', async () => {
    const { handler, calls } = endpointReturning(ok(report()))

    const response = await handler(request({}))

    assert.equal(response.status, 400)
    assert.equal(response.headers['Content-Type'], 'application/problem+json; charset=utf-8')
    assert.deepEqual(calls, [], 'le metier ne doit pas etre appele')
  })

  it('refuse une adresse vide ou trop longue', async () => {
    const { handler } = endpointReturning(ok(report()))

    assert.equal((await handler(request({ address: '   ' }))).status, 400)
    assert.equal((await handler(request({ address: 'a'.repeat(300) }))).status, 400)
  })

  it('rend 404 quand le lieu est introuvable', async () => {
    const { handler } = endpointReturning(err({ kind: 'place-not-found', address: 'Atlantide' }))

    const response = await handler(request({ address: 'Atlantide' }))

    assert.equal(response.status, 404)
    assert.equal(response.headers['Content-Type'], 'application/problem+json; charset=utf-8')
    assert.deepEqual(response.body, {
      type: 'urn:api-meteo:place-not-found',
      title: 'Lieu introuvable',
      status: 404,
      detail: 'Aucun lieu ne correspond a "Atlantide".',
    })
  })

  it('rend 503 avec le lieu deja resolu quand seule la meteo manque', async () => {
    const { handler } = endpointReturning(err({
      kind: 'forecast-unavailable',
      place: aPlace(),
      geocoding: 'live',
      cause: { kind: 'dependency-failure', dependency: 'forecast', reason: 'timeout' },
    }))

    const response = await handler(request({ address: 'Ales' }))

    assert.equal(response.status, 503)
    assert.deepEqual(response.body, {
      type: 'urn:api-meteo:dependency-unavailable',
      title: 'Previsions indisponibles',
      status: 503,
      detail: 'Le service de previsions est indisponible (timeout).',
      dependency: 'forecast',
      location: {
        label: 'Ales, Gard, Occitanie, France',
        latitude: 44.1281,
        longitude: 4.0817,
      },
      meta: {
        degraded: true,
        sources: { geocoding: 'live', forecast: 'unavailable' },
      },
    })
  })

  it('rend 503 quand le geocodage est en panne', async () => {
    const { handler } = endpointReturning(err({
      kind: 'dependency-failure',
      dependency: 'geocoding',
      reason: 'circuit-open',
    }))

    const response = await handler(request({ address: 'Ales' }))

    assert.equal(response.status, 503)
    assert.equal((response.body as { dependency?: string }).dependency, 'geocoding')
    assert.equal((response.body as { meta?: { sources?: unknown } }).meta?.sources !== undefined, true)
  })

  it('signale une reponse degradee par un en-tete Warning', async () => {
    const { handler } = endpointReturning(ok(report({
      degraded: true,
      sources: { geocoding: 'live', forecast: 'stale' },
    })))

    const response = await handler(request({ address: 'Ales' }))

    assert.equal(response.status, 200)
    assert.match(response.headers['Warning'] ?? '', /^110 /)
  })

  it('n ajoute pas d en-tete Warning sur une reponse fraiche', async () => {
    const { handler } = endpointReturning(ok(report()))

    const response = await handler(request({ address: 'Ales' }))

    assert.equal(response.headers['Warning'], undefined)
  })

  it('interdit la mise en cache publique d une reponse degradee', async () => {
    const { handler } = endpointReturning(ok(report({
      degraded: true,
      sources: { geocoding: 'stale', forecast: 'live' },
    })))

    const response = await handler(request({ address: 'Ales' }))

    assert.equal(response.headers['Cache-Control'], 'no-store')
  })
})
