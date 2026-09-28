import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createOpenMeteoForecaster } from '../../../src/infrastructure/forecast/open-meteo-forecaster.ts'
import { isErr, isOk, ok } from '../../../src/domain/result.ts'
import { fakeHttp, httpNetwork, httpOk, httpStatus, httpTimeout } from '../../support/fake-http.ts'
import { someCoordinates } from '../../support/fixtures.ts'
import type { Result } from '../../../src/domain/result.ts'
import type { HttpFailure, HttpResponse } from '../../../src/infrastructure/http/http-client.ts'

const OPEN_METEO_PAYLOAD = JSON.stringify({
  latitude: 44.125,
  longitude: 4.0,
  timezone: 'GMT',
  hourly: {
    time: ['2026-09-18T00:00', '2026-09-18T01:00', '2026-09-18T12:00'],
    temperature_2m: [0, 0, 512.4],
  },
})

const reasonOf = (error: unknown): string | undefined => (error as { reason?: string }).reason

const build = (answer: Result<HttpResponse, HttpFailure>) => {
  const http = fakeHttp(answer)
  const forecaster = createOpenMeteoForecaster({
    http: http.client,
    baseUrl: 'https://open-meteo.exemple.test',
    timeoutMs: 3_000,
  })
  return { http, forecaster }
}

describe('openMeteoForecaster', () => {
  it('traduit la reponse du fournisseur en previsions du domaine', async () => {
    const { forecaster } = build(httpOk(OPEN_METEO_PAYLOAD))

    const result = await forecaster.forecastAt(someCoordinates)

    assert.deepEqual(result, ok({
      coordinates: { latitude: 44.125, longitude: 4.0 },
      timezone: 'GMT',
      samples: [
        { time: '2026-09-18T00:00:00Z', temperatureCelsius: 0 },
        { time: '2026-09-18T01:00:00Z', temperatureCelsius: 0 },
        { time: '2026-09-18T12:00:00Z', temperatureCelsius: 512.4 },
      ],
    }))
  })

  it('construit l url de prevision attendue', async () => {
    const { http, forecaster } = build(httpOk(OPEN_METEO_PAYLOAD))

    await forecaster.forecastAt({ latitude: 44.1281, longitude: 4.0817 })
    const url = http.lastUrl()

    assert.equal(url.origin, 'https://open-meteo.exemple.test')
    assert.equal(url.pathname, '/v1/forecast')
    assert.equal(url.searchParams.get('latitude'), '44.1281')
    assert.equal(url.searchParams.get('longitude'), '4.0817')
    assert.equal(url.searchParams.get('hourly'), 'temperature_2m')
    assert.equal(url.searchParams.get('timezone'), 'GMT')
  })

  it('applique le delai maximum configure', async () => {
    const { http, forecaster } = build(httpOk(OPEN_METEO_PAYLOAD))

    await forecaster.forecastAt(someCoordinates)

    assert.equal(http.requests[0]?.timeoutMs, 3_000)
  })

  it('ecarte les points de mesure sans valeur', async () => {
    const body = JSON.stringify({
      latitude: 44.1,
      longitude: 4.0,
      timezone: 'GMT',
      hourly: { time: ['t0', 't1', 't2'], temperature_2m: [10, null, 30] },
    })
    const { forecaster } = build(httpOk(body))

    const result = await forecaster.forecastAt(someCoordinates)

    assert.equal(isOk(result), true)
    if (isOk(result)) {
      assert.deepEqual(result.value.samples, [
        { time: 't0:00Z', temperatureCelsius: 10 },
        { time: 't2:00Z', temperatureCelsius: 30 },
      ])
    }
  })

  it('retient le fuseau par defaut quand il est absent', async () => {
    const body = JSON.stringify({
      latitude: 44.1,
      longitude: 4.0,
      hourly: { time: ['t0'], temperature_2m: [10] },
    })
    const { forecaster } = build(httpOk(body))

    const result = await forecaster.forecastAt(someCoordinates)

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.equal(result.value.timezone, 'GMT')
  })

  it('refuse des series horaires de longueurs incoherentes', async () => {
    const body = JSON.stringify({
      latitude: 44.1,
      longitude: 4.0,
      timezone: 'GMT',
      hourly: { time: ['t0', 't1'], temperature_2m: [10] },
    })
    const { forecaster } = build(httpOk(body))

    const result = await forecaster.forecastAt(someCoordinates)

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(reasonOf(result.error), 'invalid-response')
  })

  it('refuse une charge utile dont la forme a change', async () => {
    const mutations = [
      'pas du json',
      '[]',
      '{"latitude":44.1,"longitude":4.0}',
      '{"latitude":44.1,"longitude":4.0,"hourly":{"time":["t0"]}}',
      '{"latitude":44.1,"longitude":4.0,"hourly":{"temperature_2m":[1]}}',
      '{"latitude":"nord","longitude":4.0,"hourly":{"time":["t0"],"temperature_2m":[1]}}',
    ]

    for (const body of mutations) {
      const { forecaster } = build(httpOk(body))
      const result = await forecaster.forecastAt(someCoordinates)

      assert.equal(isErr(result), true, `devrait refuser : ${body}`)
      if (isErr(result)) assert.equal(reasonOf(result.error), 'invalid-response', body)
    }
  })

  it('accepte une serie horaire vide', async () => {
    const body = JSON.stringify({
      latitude: 44.1,
      longitude: 4.0,
      timezone: 'GMT',
      hourly: { time: [], temperature_2m: [] },
    })
    const { forecaster } = build(httpOk(body))

    const result = await forecaster.forecastAt(someCoordinates)

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.deepEqual(result.value.samples, [])
  })

  it('traduit les pannes de transport et de statut', async () => {
    const cases = [
      { answer: httpTimeout(), reason: 'timeout' },
      { answer: httpNetwork(), reason: 'unreachable' },
      { answer: httpStatus(429), reason: 'rate-limited' },
      { answer: httpStatus(500), reason: 'upstream-error' },
    ]

    for (const { answer, reason } of cases) {
      const { forecaster } = build(answer)
      const result = await forecaster.forecastAt(someCoordinates)

      assert.equal(isErr(result), true)
      if (isErr(result)) {
        assert.equal(reasonOf(result.error), reason)
        assert.equal(result.error.dependency, 'forecast')
      }
    }
  })
})
