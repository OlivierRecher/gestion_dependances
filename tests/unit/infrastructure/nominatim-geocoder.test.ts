import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createNominatimGeocoder } from '../../../src/infrastructure/geocoding/nominatim-geocoder.ts'
import { isErr, isOk, ok } from '../../../src/domain/result.ts'
import { fakeHttp, httpNetwork, httpOk, httpStatus, httpTimeout } from '../../support/fake-http.ts'
import { anAddress } from '../../support/fixtures.ts'
import type { Result } from '../../../src/domain/result.ts'
import type { HttpFailure, HttpResponse } from '../../../src/infrastructure/http/http-client.ts'

const NOMINATIM_PAYLOAD = JSON.stringify([
  {
    place_id: 2_552_666,
    lat: '44.1281',
    lon: '4.0817',
    display_name: 'Ales, Gard, Occitanie, France',
  },
])

const build = (answer: Result<HttpResponse, HttpFailure>) => {
  const http = fakeHttp(answer)
  const geocoder = createNominatimGeocoder({
    http: http.client,
    baseUrl: 'https://nominatim.exemple.test',
    userAgent: 'api-meteo/1.0 (tp@exemple.test)',
    timeoutMs: 2_500,
  })
  return { http, geocoder }
}

describe('nominatimGeocoder', () => {
  it('traduit la reponse du fournisseur en lieu du domaine', async () => {
    const { geocoder } = build(httpOk(NOMINATIM_PAYLOAD))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.deepEqual(result, ok({
      label: 'Ales, Gard, Occitanie, France',
      coordinates: { latitude: 44.1281, longitude: 4.0817 },
    }))
  })

  it('construit l url de recherche attendue', async () => {
    const { http, geocoder } = build(httpOk(NOMINATIM_PAYLOAD))

    await geocoder.locate(anAddress('Ales'))
    const url = http.lastUrl()

    assert.equal(url.origin, 'https://nominatim.exemple.test')
    assert.equal(url.pathname, '/search')
    assert.equal(url.searchParams.get('q'), 'Ales')
    assert.equal(url.searchParams.get('format'), 'json')
    assert.equal(url.searchParams.get('limit'), '1')
  })

  it('encode les adresses contenant des caracteres speciaux', async () => {
    const { http, geocoder } = build(httpOk(NOMINATIM_PAYLOAD))

    await geocoder.locate(anAddress('Alès & Cie, 30100'))

    assert.equal(http.lastUrl().searchParams.get('q'), 'Alès & Cie, 30100')
  })

  it('identifie l appelant comme l exige la politique d usage de Nominatim', async () => {
    const { http, geocoder } = build(httpOk(NOMINATIM_PAYLOAD))

    await geocoder.locate(anAddress('Ales'))

    assert.equal(http.requests[0]?.headers?.['User-Agent'], 'api-meteo/1.0 (tp@exemple.test)')
  })

  it('applique le delai maximum configure', async () => {
    const { http, geocoder } = build(httpOk(NOMINATIM_PAYLOAD))

    await geocoder.locate(anAddress('Ales'))

    assert.equal(http.requests[0]?.timeoutMs, 2_500)
  })

  it('signale un lieu introuvable sur un resultat vide', async () => {
    const { geocoder } = build(httpOk('[]'))

    const result = await geocoder.locate(anAddress('Atlantide'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.deepEqual(result.error, { kind: 'place-not-found', address: 'Atlantide' })
  })

  it('traduit un quota depasse', async () => {
    const { geocoder } = build(httpStatus(429))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.match(String((result.error as { reason?: string }).reason), /rate-limited/)
  })

  it('traduit une erreur serveur amont', async () => {
    const { geocoder } = build(httpStatus(500, 'boom'))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) {
      assert.deepEqual(
        { kind: result.error.kind, reason: (result.error as { reason?: string }).reason },
        { kind: 'dependency-failure', reason: 'upstream-error' },
      )
    }
  })

  it('traduit un timeout de transport', async () => {
    const { geocoder } = build(httpTimeout())

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal((result.error as { reason?: string }).reason, 'timeout')
  })

  it('traduit une panne reseau en service injoignable', async () => {
    const { geocoder } = build(httpNetwork())

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal((result.error as { reason?: string }).reason, 'unreachable')
  })

  it('refuse un corps qui n est pas du JSON', async () => {
    const { geocoder } = build(httpOk('<html>maintenance</html>'))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal((result.error as { reason?: string }).reason, 'invalid-response')
  })

  it('refuse une charge utile dont la forme a change', async () => {
    const mutations = [
      '{"resultats":[]}',
      JSON.stringify([{ lat: '44.1', display_name: 'sans longitude' }]),
      JSON.stringify([{ lat: 'pas-un-nombre', lon: '4.0', display_name: 'x' }]),
      JSON.stringify([{ lat: '44.1', lon: '4.0' }]),
    ]

    for (const body of mutations) {
      const { geocoder } = build(httpOk(body))
      const result = await geocoder.locate(anAddress('Ales'))

      assert.equal(isErr(result), true, `devrait refuser : ${body}`)
      if (isErr(result)) assert.equal((result.error as { reason?: string }).reason, 'invalid-response', body)
    }
  })

  it('refuse des coordonnees hors bornes terrestres', async () => {
    const body = JSON.stringify([{ lat: '99.0', lon: '4.0', display_name: 'nulle part' }])
    const { geocoder } = build(httpOk(body))

    const result = await geocoder.locate(anAddress('Ales'))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal((result.error as { reason?: string }).reason, 'invalid-response')
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
