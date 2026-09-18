import type { Address } from '../../domain/address.ts'
import { createCoordinates } from '../../domain/coordinates.ts'
import type { Place } from '../../domain/model.ts'
import type { GeocodingService } from '../../domain/ports.ts'
import { err, ok } from '../../domain/result.ts'
import { fromHttpFailure, fromStatus, invalidResponse } from '../http/failure-mapping.ts'
import type { HttpClient } from '../http/http-client.ts'
import { asArray, asFiniteNumber, asString, isRecord, parseJson } from '../http/json.ts'

export type BanGeocoderOptions = {
  readonly http: HttpClient
  readonly baseUrl: string
  readonly timeoutMs: number
}

const DEPENDENCY = 'geocoding' as const

/** Traduit une feature GeoJSON de la BAN en `Place`, ou `undefined` si la forme est inattendue. */
const toPlace = (feature: unknown): Place | undefined => {
  if (!isRecord(feature)) return undefined

  const properties = feature['properties']
  if (!isRecord(properties)) return undefined
  const label = asString(properties['label'])
  if (label === undefined) return undefined

  const geometry = feature['geometry']
  if (!isRecord(geometry)) return undefined
  const coordinates = asArray(geometry['coordinates'])
  if (coordinates === undefined || coordinates.length < 2) return undefined

  // GeoJSON ordonne [longitude, latitude], a l'inverse du reste du domaine.
  const longitude = asFiniteNumber(coordinates[0])
  const latitude = asFiniteNumber(coordinates[1])
  if (longitude === undefined || latitude === undefined) return undefined

  const parsed = createCoordinates(latitude, longitude)
  if (!parsed.ok) return undefined

  return { label, coordinates: parsed.value }
}

/** Adaptateur BAN (Base Adresse Nationale) : seul endroit a connaitre son GeoJSON (`features[].properties.label`, `geometry.coordinates`). */
export const createBanGeocoder = (options: BanGeocoderOptions): GeocodingService => ({
  async locate(address: Address) {
    const url = new URL('/search/', options.baseUrl)
    url.searchParams.set('q', address)
    url.searchParams.set('limit', '1')

    const response = await options.http.get({ url: url.toString(), timeoutMs: options.timeoutMs })

    if (!response.ok) return err(fromHttpFailure(DEPENDENCY, response.error))

    const statusFailure = fromStatus(DEPENDENCY, response.value.status)
    if (statusFailure !== undefined) return err(statusFailure)

    const payload = parseJson(response.value.body)
    if (!payload.ok) return err(invalidResponse(DEPENDENCY, 'corps illisible'))
    if (!isRecord(payload.value)) return err(invalidResponse(DEPENDENCY, 'objet attendu'))

    const features = asArray(payload.value['features'])
    if (features === undefined) return err(invalidResponse(DEPENDENCY, 'tableau de resultats attendu'))
    if (features.length === 0) return err({ kind: 'place-not-found', address })

    const place = toPlace(features[0])
    if (place === undefined) return err(invalidResponse(DEPENDENCY, 'resultat inexploitable'))

    return ok(place)
  },
})
