import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createMetNorwayForecaster } from '../../../src/infrastructure/forecast/met-norway-forecaster.ts'
import { isErr } from '../../../src/domain/result.ts'
import { fakeHttp, httpNetwork, httpOk, httpStatus, httpTimeout } from '../../support/fake-http.ts'
import { someCoordinates } from '../../support/fixtures.ts'
import type { Result } from '../../../src/domain/result.ts'
import type { HttpFailure, HttpResponse } from '../../../src/infrastructure/http/http-client.ts'

const LOCATIONFORECAST_PAYLOAD = JSON.stringify({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [4.08, 44.12, 122] },
  properties: {
    meta: { updated_at: '2026-09-18T13:00:00Z', units: {} },
    timeseries: [
      { time: '2026-09-18T13:00:00Z', data: { instant: { details: { air_temperature: 26.6, cloud_area_fraction: 1.6 } } } },
    ],
  },
})

const reasonOf = (error: unknown): string | undefined => (error as { reason?: string }).reason
const detailOf = (error: unknown): string | undefined => (error as { detail?: string }).detail

const build = (answer: Result<HttpResponse, HttpFailure>) => {
  const http = fakeHttp(answer)
  const forecaster = createMetNorwayForecaster({
    http: http.client,
    baseUrl: 'https://met-norway.exemple.test',
    userAgent: 'TP2-MeteoApi/1.0 tp@exemple.test',
    timeoutMs: 3_000,
  })
  return { http, forecaster }
}

describe('metNorwayForecaster', () => {
  it('ne peut jamais satisfaire le contrat Forecast : ce fournisseur ne publie pas de rayonnement solaire', async () => {
    const { forecaster } = build(httpOk(LOCATIONFORECAST_PAYLOAD))

    const result = await forecaster.forecastAt(someCoordinates)

    assert.equal(isErr(result), true)
    if (isErr(result)) {
      assert.equal(result.error.kind, 'dependency-failure')
      assert.equal(reasonOf(result.error), 'invalid-response')
      assert.match(detailOf(result.error) ?? '', /shortwave_radiation/)
    }
  })

  it('construit l url de prevision attendue', async () => {
    const { http, forecaster } = build(httpOk(LOCATIONFORECAST_PAYLOAD))

    await forecaster.forecastAt({ latitude: 44.1281, longitude: 4.0817 })
    const url = http.lastUrl()

    assert.equal(url.origin, 'https://met-norway.exemple.test')
    assert.equal(url.pathname, '/weatherapi/locationforecast/2.0/compact')
    assert.equal(url.searchParams.get('lat'), '44.1281')
    assert.equal(url.searchParams.get('lon'), '4.0817')
  })

  it('identifie l appelant comme l exige la politique d usage de MET Norway', async () => {
    const { http, forecaster } = build(httpOk(LOCATIONFORECAST_PAYLOAD))

    await forecaster.forecastAt(someCoordinates)

    assert.equal(http.requests[0]?.headers?.['User-Agent'], 'TP2-MeteoApi/1.0 tp@exemple.test')
  })

  it('applique le delai maximum configure', async () => {
    const { http, forecaster } = build(httpOk(LOCATIONFORECAST_PAYLOAD))

    await forecaster.forecastAt(someCoordinates)

    assert.equal(http.requests[0]?.timeoutMs, 3_000)
  })

  it('refuse un corps qui n est pas du JSON', async () => {
    const { forecaster } = build(httpOk('<html>maintenance</html>'))

    const result = await forecaster.forecastAt(someCoordinates)

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(reasonOf(result.error), 'invalid-response')
  })

  it('refuse une charge utile dont la forme a change', async () => {
    const mutations = [
      '{}',
      '{"geometry":{}}',
      '{"geometry":{"coordinates":[4.08]},"properties":{"timeseries":[]}}',
      '{"geometry":{"coordinates":[4.08,44.12]},"properties":{}}',
      '{"geometry":{"coordinates":["est",44.12]},"properties":{"timeseries":[]}}',
    ]

    for (const body of mutations) {
      const { forecaster } = build(httpOk(body))
      const result = await forecaster.forecastAt(someCoordinates)

      assert.equal(isErr(result), true, `devrait refuser : ${body}`)
      if (isErr(result)) assert.equal(reasonOf(result.error), 'invalid-response', body)
    }
  })

  it('traduit les pannes de transport et de statut', async () => {
    const cases = [
      { answer: httpTimeout(), reason: 'timeout' },
      { answer: httpNetwork(), reason: 'unreachable' },
      { answer: httpStatus(429), reason: 'rate-limited' },
      { answer: httpStatus(403), reason: 'upstream-error' },
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
