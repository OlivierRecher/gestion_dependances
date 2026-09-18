import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createBanGeocoder } from '../../../src/infrastructure/geocoding/ban-geocoder.ts'
import { isErr, isOk, ok } from '../../../src/domain/result.ts'
import { fakeHttp, httpNetwork, httpOk, httpStatus, httpTimeout } from '../../support/fake-http.ts'
import { anAddress } from '../../support/fixtures.ts'
import type { Result } from '../../../src/domain/result.ts'
import type { HttpFailure, HttpResponse } from '../../../src/infrastructure/http/http-client.ts'

const BAN_PAYLOAD = JSON.stringify({
  type: 'FeatureCollection',
  version: 'draft',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [4.0817, 44.1281] },
      properties: {
        label: 'Ales, Gard, Occitanie, France',
        score: 0.49,
        id: '30007',
      },
    },
  ],
  attribution: 'BAN',
  licence: 'ETALAB-2.0',
  query: 'Ales',
  limit: 1,
})

const reasonOf = (error: unknown): string | undefined => (error as { reason?: string }).reason

const build = (answer: Result<HttpResponse, HttpFailure>) => {
  const http = fakeHttp(answer)
  const geocoder = createBanGeocoder({
    http: http.client,
    baseUrl: 'https://ban.exemple.test',
    timeoutMs: 2_500,
  })
  return { http, geocoder }
}

describe('banGeocoder', () => {
  it('traduit la reponse du fournisseur en lieu du domaine', async () => {
    const { geocoder } = build(httpOk(BAN_PAYLOAD))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.deepEqual(result, ok({
      label: 'Ales, Gard, Occitanie, France',
      coordinates: { latitude: 44.1281, longitude: 4.0817 },
    }))
  })

  it('construit l url de recherche attendue', async () => {
    const { http, geocoder } = build(httpOk(BAN_PAYLOAD))

    await geocoder.locate(anAddress('Ales'))
    const url = http.lastUrl()

    assert.equal(url.origin, 'https://ban.exemple.test')
    assert.equal(url.pathname, '/search/')
    assert.equal(url.searchParams.get('q'), 'Ales')
    assert.equal(url.searchParams.get('limit'), '1')
  })

  it('encode les adresses contenant des caracteres speciaux', async () => {
    const { http, geocoder } = build(httpOk(BAN_PAYLOAD))

    await geocoder.locate(anAddress('Alès & Cie, 30100'))

    assert.equal(http.lastUrl().searchParams.get('q'), 'Alès & Cie, 30100')
  })

  it('applique le delai maximum configure', async () => {
    const { http, geocoder } = build(httpOk(BAN_PAYLOAD))

    await geocoder.locate(anAddress('Ales'))

    assert.equal(http.requests[0]?.timeoutMs, 2_500)
  })

  it('signale un lieu introuvable sur une collection de resultats vide', async () => {
    const body = JSON.stringify({ type: 'FeatureCollection', features: [] })
    const { geocoder } = build(httpOk(body))

    const result = await geocoder.locate(anAddress('Atlantide'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.deepEqual(result.error, { kind: 'place-not-found', address: 'Atlantide' })
  })

  it('traduit un quota depasse', async () => {
    const { geocoder } = build(httpStatus(429))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(reasonOf(result.error), 'rate-limited')
  })

  it('traduit une erreur serveur amont', async () => {
    const { geocoder } = build(httpStatus(500, 'boom'))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) {
      assert.deepEqual(
        { kind: result.error.kind, reason: reasonOf(result.error) },
        { kind: 'dependency-failure', reason: 'upstream-error' },
      )
    }
  })

  it('traduit un timeout de transport', async () => {
    const { geocoder } = build(httpTimeout())

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(reasonOf(result.error), 'timeout')
  })

  it('traduit une panne reseau en service injoignable', async () => {
    const { geocoder } = build(httpNetwork())

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(reasonOf(result.error), 'unreachable')
  })

  it('refuse un corps qui n est pas du JSON', async () => {
    const { geocoder } = build(httpOk('<html>maintenance</html>'))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(reasonOf(result.error), 'invalid-response')
  })

  it('refuse une charge utile dont la forme a change', async () => {
    const mutations = [
      '[]',
      '{"resultats":[]}',
      JSON.stringify({ features: [{ geometry: { coordinates: [4.0] }, properties: { label: 'x' } }] }),
      JSON.stringify({ features: [{ geometry: { coordinates: [4.0, 44.1] }, properties: {} }] }),
      JSON.stringify({ features: [{ geometry: {}, properties: { label: 'x' } }] }),
      JSON.stringify({ features: [{ geometry: { coordinates: ['nord', 4.0] }, properties: { label: 'x' } }] }),
    ]

    for (const body of mutations) {
      const { geocoder } = build(httpOk(body))
      const result = await geocoder.locate(anAddress('Ales'))

      assert.equal(isErr(result), true, `devrait refuser : ${body}`)
      if (isErr(result)) assert.equal(reasonOf(result.error), 'invalid-response', body)
    }
  })

  it('refuse des coordonnees hors bornes terrestres', async () => {
    const body = JSON.stringify({
      features: [{ geometry: { coordinates: [4.0, 99.0] }, properties: { label: 'nulle part' } }],
    })
    const { geocoder } = build(httpOk(body))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(reasonOf(result.error), 'invalid-response')
  })

  it('attribue toujours ses pannes a la dependance geocodage', async () => {
    for (const answer of [httpStatus(500), httpTimeout(), httpNetwork(), httpOk('nope')]) {
      const { geocoder } = build(answer)
      const result = await geocoder.locate(anAddress('Ales'))

      assert.equal(isOk(result), false)
      if (isErr(result) && result.error.kind === 'dependency-failure') {
        assert.equal(result.error.dependency, 'geocoding')
      }
    }
  })
})
