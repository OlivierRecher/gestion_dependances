import type { Address } from '../domain/address.ts'
import type { ForecastUnavailable, PlaceNotFound, DependencyFailure } from '../domain/failures.ts'
import type { Forecast, Freshness, Place } from '../domain/model.ts'
import type { ForecastPort, GeocodingPort } from '../domain/ports.ts'
import { err, ok, type Result } from '../domain/result.ts'

export type WeatherReport = {
  readonly address: Address
  readonly place: Place
  readonly forecast: Forecast
  readonly degraded: boolean
  readonly sources: {
    readonly geocoding: Freshness
    readonly forecast: Freshness
  }
}

export type WeatherReportFailure = DependencyFailure | PlaceNotFound | ForecastUnavailable

export type GetWeatherForAddress = (
  address: Address,
) => Promise<Result<WeatherReport, WeatherReportFailure>>

export type GetWeatherForAddressDeps = {
  readonly geocoding: GeocodingPort
  readonly forecast: ForecastPort
}

/** Une donnee perimee reste exploitable, mais le rapport doit le signaler. */
const isDegraded = (...freshness: readonly Freshness[]): boolean => freshness.includes('stale')

/**
 * Cas d'usage : adresse postale -> previsions.
 *
 * Il ne connait que deux interfaces et ne fait aucun appel reseau, aucune
 * lecture d'environnement, aucun acces a l'horloge. C'est ce qui le rend
 * testable en memoire, sans fake lourd ni serveur.
 */
export const createGetWeatherForAddress = (
  deps: GetWeatherForAddressDeps,
): GetWeatherForAddress => async (address) => {
  const located = await deps.geocoding.locate(address)
  if (!located.ok) return err(located.error)

  const place = located.value.data
  const forecast = await deps.forecast.forecastAt(place.coordinates)
  if (!forecast.ok) {
    return err({
      kind: 'forecast-unavailable',
      place,
      geocoding: located.value.freshness,
      cause: forecast.error,
    })
  }

  return ok({
    address,
    place,
    forecast: forecast.value.data,
    degraded: isDegraded(located.value.freshness, forecast.value.freshness),
    sources: {
      geocoding: located.value.freshness,
      forecast: forecast.value.freshness,
    },
  })
}
