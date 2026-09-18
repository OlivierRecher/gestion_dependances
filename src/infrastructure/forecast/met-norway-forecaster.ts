import type { Coordinates } from '../../domain/model.ts'
import type { ForecastService } from '../../domain/ports.ts'
import { err } from '../../domain/result.ts'
import { fromHttpFailure, fromStatus, invalidResponse } from '../http/failure-mapping.ts'
import type { HttpClient } from '../http/http-client.ts'
import { asArray, asFiniteNumber, isRecord, parseJson } from '../http/json.ts'

export type MetNorwayForecasterOptions = {
  readonly http: HttpClient
  readonly baseUrl: string
  /** MET Norway exige un agent identifiable ; sans lui, les appels sont rejetes (403). */
  readonly userAgent: string
  readonly timeoutMs: number
}

const DEPENDENCY = 'forecast' as const

const NO_RADIATION_DETAIL =
  'Locationforecast ne publie pas de rayonnement solaire (shortwave_radiation) : contrat Forecast non satisfiable par ce fournisseur'

/**
 * Verifie juste que la reponse a la forme attendue d'un Locationforecast ;
 * on ne construit jamais de `Forecast` a partir d'elle, ce fournisseur ne
 * publie pas la grandeur que le domaine exige (voir `NO_RADIATION_DETAIL`).
 */
const isWellFormedLocationforecast = (payload: unknown): boolean => {
  if (!isRecord(payload)) return false

  const geometry = payload['geometry']
  if (!isRecord(geometry)) return false

  const coordinates = asArray(geometry['coordinates'])
  if (coordinates === undefined || coordinates.length < 2) return false
  if (asFiniteNumber(coordinates[0]) === undefined || asFiniteNumber(coordinates[1]) === undefined) return false

  const properties = payload['properties']
  if (!isRecord(properties)) return false

  return asArray(properties['timeseries']) !== undefined
}

/**
 * Adaptateur MET Norway : meme structure que les autres adaptateurs
 * (delai, User-Agent, traduction des pannes de transport et de statut),
 * mais ne peut jamais honorer le contrat `ForecastService` : Locationforecast
 * n'expose aucune serie de rayonnement solaire. L'echec est explicite et
 * documente plutot que d'inventer une valeur.
 */
export const createMetNorwayForecaster = (options: MetNorwayForecasterOptions): ForecastService => ({
  async forecastAt(coordinates: Coordinates) {
    const url = new URL('/weatherapi/locationforecast/2.0/compact', options.baseUrl)
    url.searchParams.set('lat', String(coordinates.latitude))
    url.searchParams.set('lon', String(coordinates.longitude))

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

    if (!isWellFormedLocationforecast(payload.value)) {
      return err(invalidResponse(DEPENDENCY, 'previsions inexploitables'))
    }

    return err(invalidResponse(DEPENDENCY, NO_RADIATION_DETAIL))
  },
})
