import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createBanGeocoder } from '../../../src/infrastructure/geocoding/ban-geocoder.ts'
import { createNominatimGeocoder } from '../../../src/infrastructure/geocoding/nominatim-geocoder.ts'
import { isErr, isOk } from '../../../src/domain/result.ts'
import { fakeHttp, httpOk } from '../../support/fake-http.ts'
import { anAddress } from '../../support/fixtures.ts'
import type { Coordinates, Place } from '../../../src/domain/model.ts'
import type { GeocodingService } from '../../../src/domain/ports.ts'

/**
 * Suite de tests de contrat unique (voir TP2, point 3) : les mêmes scénarios,
 * exécutés à l'identique contre chaque implémentation de `GeocodingService`,
 * bouchonnée au niveau HTTP. Une implémentation qui s'écarte du contrat casse
 * ici, pas seulement dans ses propres tests unitaires.
 */
type ProviderCase = {
  readonly name: string
  readonly build: (body: string) => GeocodingService
  readonly validPayload: string
  readonly expectedPlace: Place
  readonly notFoundPayload: string
}

const EXPECTED_PLACE: Place = {
  label: 'Ales, Gard, Occitanie, France',
  coordinates: { latitude: 44.1281, longitude: 4.0817 } satisfies Coordinates,
}

const PROVIDERS: readonly ProviderCase[] = [
  {
    name: 'nominatim',
    build: (body) => createNominatimGeocoder({
      http: fakeHttp(httpOk(body)).client,
      baseUrl: 'https://nominatim.exemple.test',
      userAgent: 'api-meteo/1.0 (tp@exemple.test)',
      timeoutMs: 2_000,
    }),
    validPayload: JSON.stringify([
      { lat: '44.1281', lon: '4.0817', display_name: EXPECTED_PLACE.label },
    ]),
    expectedPlace: EXPECTED_PLACE,
    notFoundPayload: '[]',
  },
  {
    name: 'ban',
    build: (body) => createBanGeocoder({
      http: fakeHttp(httpOk(body)).client,
      baseUrl: 'https://ban.exemple.test',
      timeoutMs: 2_000,
    }),
    validPayload: JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [4.0817, 44.1281] },
        properties: { label: EXPECTED_PLACE.label },
      }],
    }),
    expectedPlace: EXPECTED_PLACE,
    notFoundPayload: JSON.stringify({ type: 'FeatureCollection', features: [] }),
  },
]

for (const provider of PROVIDERS) {
  describe(`contrat GeocodingService : ${provider.name}`, () => {
    it('resout une adresse valide en lieu exploitable', async () => {
      const geocoder = provider.build(provider.validPayload)

      const result = await geocoder.locate(anAddress('Ales'))

      assert.equal(isOk(result), true)
      if (isOk(result)) assert.deepEqual(result.value, provider.expectedPlace)
    })

    it('signale une adresse introuvable', async () => {
      const geocoder = provider.build(provider.notFoundPayload)

      const result = await geocoder.locate(anAddress('Atlantide'))

      assert.equal(isErr(result), true)
      if (isErr(result)) assert.deepEqual(result.error, { kind: 'place-not-found', address: 'Atlantide' })
    })

    it('refuse une reponse vide (corps illisible)', async () => {
      const geocoder = provider.build('')

      const result = await geocoder.locate(anAddress('Ales'))

      assert.equal(isErr(result), true)
      if (isErr(result)) assert.equal((result.error as { reason?: string }).reason, 'invalid-response')
    })

    it('preserve les caracteres accentues jusque dans la requete', async () => {
      const http = fakeHttp(httpOk(provider.validPayload))
      const geocoder = provider.name === 'nominatim'
        ? createNominatimGeocoder({ http: http.client, baseUrl: 'https://x.test', userAgent: 'a/1.0', timeoutMs: 2_000 })
        : createBanGeocoder({ http: http.client, baseUrl: 'https://x.test', timeoutMs: 2_000 })

      await geocoder.locate(anAddress('Alès & Cie, 30100'))

      assert.equal(http.lastUrl().searchParams.get('q'), 'Alès & Cie, 30100')
    })
  })
}
