import { createCoordinates } from '../../domain/coordinates.ts'
import type { Coordinates, Forecast, RadiationSample } from '../../domain/model.ts'
import type { Forecaster } from '../../domain/ports.ts'
import { err, ok } from '../../domain/result.ts'
import { fromHttpFailure, fromStatus, invalidResponse } from '../http/failure-mapping.ts'
import type { HttpClient } from '../http/http-client.ts'
import { asFiniteNumber, asNullableNumberArray, asString, asStringArray, isRecord, parseJson } from '../http/json.ts'

export type OpenMeteoForecasterOptions = {
  readonly http: HttpClient
  readonly baseUrl: string
  readonly timeoutMs: number
}

const DEPENDENCY = 'forecast' as const
const VARIABLE = 'shortwave_radiation'
const DEFAULT_TIMEZONE = 'GMT'

/**
 * Recompose les series paralleles d'Open-Meteo (`time[]` et
 * `shortwave_radiation[]`) en points de mesure. Les trous (`null`) sont
 * ecartes plutot que propages en `NaN` : mieux vaut une serie plus courte
 * qu'une valeur fausse.
 */
const toSamples = (times: readonly string[], values: readonly (number | null)[]): RadiationSample[] => {
  const samples: RadiationSample[] = []

  for (const [index, time] of times.entries()) {
    const value = values[index]
    if (value === null || value === undefined) continue
    samples.push({ time, shortwaveRadiation: value })
  }

  return samples
}

const toForecast = (payload: unknown): Forecast | undefined => {
  if (!isRecord(payload)) return undefined

  const latitude = asFiniteNumber(payload['latitude'])
  const longitude = asFiniteNumber(payload['longitude'])
  if (latitude === undefined || longitude === undefined) return undefined

  const coordinates = createCoordinates(latitude, longitude)
  if (!coordinates.ok) return undefined

  const hourly = payload['hourly']
  if (!isRecord(hourly)) return undefined

  const times = asStringArray(hourly['time'])
  const values = asNullableNumberArray(hourly[VARIABLE])
  if (times === undefined || values === undefined) return undefined
  if (times.length !== values.length) return undefined

  return {
    coordinates: coordinates.value,
    timezone: asString(payload['timezone']) ?? DEFAULT_TIMEZONE,
    samples: toSamples(times, values),
  }
}

/**
 * Adaptateur Open-Meteo : couche anti-corruption.
 *
 * Symetrique de l'adaptateur de geocodage, et tout aussi ignorant du reste du
 * systeme. Il ne sait pas qu'un cache existe, ni qu'un circuit breaker le
 * protege : ces politiques lui sont appliquees depuis la racine de composition.
 */
export const createOpenMeteoForecaster = (options: OpenMeteoForecasterOptions): Forecaster =>
  async (coordinates: Coordinates) => {
    const url = new URL('/v1/forecast', options.baseUrl)
    url.searchParams.set('latitude', String(coordinates.latitude))
    url.searchParams.set('longitude', String(coordinates.longitude))
    url.searchParams.set('hourly', VARIABLE)

    const response = await options.http.get({ url: url.toString(), timeoutMs: options.timeoutMs })

    if (!response.ok) return err(fromHttpFailure(DEPENDENCY, response.error))

    const statusFailure = fromStatus(DEPENDENCY, response.value.status)
    if (statusFailure !== undefined) return err(statusFailure)

    const payload = parseJson(response.value.body)
    if (!payload.ok) return err(invalidResponse(DEPENDENCY, 'corps illisible'))

    const forecast = toForecast(payload.value)
    if (forecast === undefined) return err(invalidResponse(DEPENDENCY, 'previsions inexploitables'))

    return ok(forecast)
  }
