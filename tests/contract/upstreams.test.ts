import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createOpenMeteoForecaster } from '../../src/infrastructure/forecast/open-meteo-forecaster.ts'
import { createNominatimGeocoder } from '../../src/infrastructure/geocoding/nominatim-geocoder.ts'
import { createFetchHttpClient } from '../../src/infrastructure/http/fetch-http-client.ts'
import { isOk } from '../../src/domain/result.ts'
import { anAddress } from '../support/fixtures.ts'

/**
 * Tests de contrat : les seuls du projet qui sortent sur le reseau.
 *
 * Les tests unitaires figent la forme des reponses attendues. Rien ne garantit
 * que les vrais services la respectent toujours : une API tierce peut changer
 * sans previs, et c'est precisement le risque que le cours appelle une
 * dependance externe. Ces tests repondent a la question "notre lecture
 * correspond-elle encore a la realite ?".
 *
 * Ils sont exclus de `npm test` a dessein : la suite ne doit dependre ni du
 * reseau, ni de la disponibilite d'un tiers, ni de son quota. On les lance
 * deliberement, avec `npm run test:contract`.
 */
const SKIP = process.env['CONTRACT_TESTS'] === '1'
  ? false
  : 'active par : npm run test:contract'

const http = createFetchHttpClient({ fetch: globalThis.fetch })

describe('contrat des services externes', { skip: SKIP }, () => {
  it('Nominatim renvoie encore un lieu exploitable', async () => {
    const geocoder = createNominatimGeocoder({
      http,
      baseUrl: 'https://nominatim.openstreetmap.org',
      userAgent: 'api-meteo/1.0 (TP gestion des dependances)',
      timeoutMs: 10_000,
    })

    // Requete volontairement sans ambiguite : ce test verifie que notre
    // lecture du format tient encore, pas le classement des resultats de
    // Nominatim, qui peut legitimement evoluer.
    const result = await geocoder.locate(anAddress('Ales, Gard, France'))

    assert.equal(isOk(result), true, 'le contrat de geocodage a change, ou le service est indisponible')
    if (!isOk(result)) return
    assert.ok(result.value.label.length > 0, 'libelle absent')
    assert.ok(Math.abs(result.value.coordinates.latitude - 44.12) < 1, `latitude inattendue : ${result.value.coordinates.latitude}`)
    assert.ok(Math.abs(result.value.coordinates.longitude - 4.08) < 1, `longitude inattendue : ${result.value.coordinates.longitude}`)
  })

  it('Open-Meteo renvoie encore une serie de rayonnement exploitable', async () => {
    const forecaster = createOpenMeteoForecaster({
      http,
      baseUrl: 'https://api.open-meteo.com',
      timeoutMs: 10_000,
    })

    const result = await forecaster.forecastAt({ latitude: 44.1281, longitude: 4.0817 })

    assert.equal(isOk(result), true, 'le contrat de previsions a change, ou le service est indisponible')
    if (!isOk(result)) return
    assert.ok(result.value.samples.length > 0, 'serie horaire vide')
    assert.ok(result.value.samples.every((sample) => Number.isFinite(sample.shortwaveRadiation)))
    assert.ok(result.value.timezone.length > 0)
  })
})
