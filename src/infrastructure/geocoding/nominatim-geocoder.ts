import type { Address } from '../../domain/address.ts'
import { createCoordinates } from '../../domain/coordinates.ts'
import type { Place } from '../../domain/model.ts'
import type { Geocoder } from '../../domain/ports.ts'
import { err, ok } from '../../domain/result.ts'
import { fromHttpFailure, fromStatus, invalidResponse } from '../http/failure-mapping.ts'
import type { HttpClient } from '../http/http-client.ts'
import { asFiniteNumber, asString, isRecord, parseJson } from '../http/json.ts'

export type NominatimGeocoderOptions = {
  readonly http: HttpClient
  readonly baseUrl: string
  /** Nominatim exige un agent identifiable ; sans lui, les appels sont bloques. */
  readonly userAgent: string
  readonly timeoutMs: number
}

const DEPENDENCY = 'geocoding' as const

/**
 * Traduit une entree de resultat Nominatim en `Place`. Renvoie `undefined` si
 * la forme ne correspond pas a ce que nous attendons.
 */
const toPlace = (entry: unknown): Place | undefined => {
  if (!isRecord(entry)) return undefined

  const label = asString(entry['display_name'])
  const latitude = asFiniteNumber(entry['lat'])
  const longitude = asFiniteNumber(entry['lon'])
  if (label === undefined || latitude === undefined || longitude === undefined) return undefined

  const coordinates = createCoordinates(latitude, longitude)
  if (!coordinates.ok) return undefined

  return { label, coordinates: coordinates.value }
}

/**
 * Adaptateur Nominatim : couche anti-corruption.
 *
 * Il est le seul endroit du projet a connaitre les noms de champs
 * `display_name`, `lat`, `lon` et la convention "tableau vide = introuvable".
 * Le vocabulaire du fournisseur s'arrete ici ; au-dela, on ne manipule plus
 * que des types du domaine. Changer de geocodeur (Ban, Google, Photon) revient
 * a ecrire un autre fichier de cette forme, sans toucher au metier.
 */
export const createNominatimGeocoder = (options: NominatimGeocoderOptions): Geocoder =>
  async (address: Address) => {
    const url = new URL('/search', options.baseUrl)
    url.searchParams.set('q', address)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '1')

    const response = await options.http.get({
      url: url.toString(),
      headers: { 'User-Agent': options.userAgent },
      timeoutMs: options.timeoutMs,
    })

    if (!response.ok) return err(fromHttpFailure(DEPENDENCY, response.error))

    const statusFailure = fromStatus(DEPENDENCY, response.value.status)
    if (statusFailure !== undefined) return err(statusFailure)

    const payload = parseJson(response.value.body)
    if (!payload.ok) return err(invalidResponse(DEPENDENCY, 'corps illisible'))
    if (!Array.isArray(payload.value)) {
      return err(invalidResponse(DEPENDENCY, 'tableau de resultats attendu'))
    }

    if (payload.value.length === 0) return err({ kind: 'place-not-found', address })

    const place = toPlace(payload.value[0])
    if (place === undefined) return err(invalidResponse(DEPENDENCY, 'resultat inexploitable'))

    return ok(place)
  }
