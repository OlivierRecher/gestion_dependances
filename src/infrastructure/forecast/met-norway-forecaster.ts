import { createCoordinates } from '../../domain/coordinates.ts'
import type { Coordinates, Forecast, TemperatureSample } from '../../domain/model.ts'
import type { ForecastService } from '../../domain/ports.ts'
import { err, ok } from '../../domain/result.ts'
import { fromHttpFailure, fromStatus, invalidResponse } from '../http/failure-mapping.ts'
import type { HttpClient } from '../http/http-client.ts'
import { asArray, asFiniteNumber, asString, isRecord, parseJson } from '../http/json.ts'

export type MetNorwayForecasterOptions = {
  readonly http: HttpClient
  readonly baseUrl: string
  /** MET Norway l'exige ; sans lui, les appels sont rejetes (403). */
  readonly userAgent: string
  readonly timeoutMs: number
}

const DEPENDENCY = 'forecast' as const
/** Locationforecast date ses points en UTC (`2026-09-18T13:00:00Z`). */
const TIMEZONE = 'GMT'

/** Un point `timeseries[]` sans temperature est ecarte, comme un trou chez Open-Meteo. */
const toSample = (entry: unknown): TemperatureSample | undefined => {
  if (!isRecord(entry)) return undefined
  const time = asString(entry['time'])
  const data = entry['data']
  if (time === undefined || !isRecord(data)) return undefined
  const instant = data['instant']
  if (!isRecord(instant)) return undefined
  const details = instant['details']
  if (!isRecord(details)) return undefined

  const temperatureCelsius = asFiniteNumber(details['air_temperature'])
  return temperatureCelsius === undefined ? undefined : { time, temperatureCelsius }
}

const toForecast = (payload: unknown): Forecast | undefined => {
  if (!isRecord(payload)) return undefined

  const geometry = payload['geometry']
  if (!isRecord(geometry)) return undefined

  // GeoJSON ordonne [longitude, latitude, altitude].
  const position = asArray(geometry['coordinates'])
  if (position === undefined || position.length < 2) return undefined
  const longitude = asFiniteNumber(position[0])
  const latitude = asFiniteNumber(position[1])
  if (longitude === undefined || latitude === undefined) return undefined

  const coordinates = createCoordinates(latitude, longitude)
  if (!coordinates.ok) return undefined

  const properties = payload['properties']
  if (!isRecord(properties)) return undefined
  const timeseries = asArray(properties['timeseries'])
  if (timeseries === undefined) return undefined

  return {
    coordinates: coordinates.value,
    timezone: TIMEZONE,
    samples: timeseries.map(toSample).filter((sample) => sample !== undefined),
  }
}

/** Adaptateur MET Norway : seul endroit a connaitre le GeoJSON de Locationforecast. */
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

    const forecast = toForecast(payload.value)
    if (forecast === undefined) return err(invalidResponse(DEPENDENCY, 'previsions inexploitables'))

    return ok(forecast)
  },
})
