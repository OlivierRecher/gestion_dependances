import { createGetWeatherForAddress } from '../application/get-weather-for-address.ts'
import type { Config } from '../config/config.ts'
import type { DependencyFailure, PlaceNotFound } from '../domain/failures.ts'
import type { Coordinates, Forecast, Place } from '../domain/model.ts'
import type { ClockPort, ForecastPort, GeocodingPort } from '../domain/ports.ts'
import { createOpenMeteoForecaster } from '../infrastructure/forecast/open-meteo-forecaster.ts'
import { createNominatimGeocoder } from '../infrastructure/geocoding/nominatim-geocoder.ts'
import { createFetchHttpClient, type FetchLike } from '../infrastructure/http/fetch-http-client.ts'
import { circuitOpen } from '../infrastructure/http/failure-mapping.ts'
import { createHealthEndpoint, type DependencyStatus } from '../interface/http/health-endpoint.ts'
import { createRouter } from '../interface/http/router.ts'
import { createWeatherEndpoint } from '../interface/http/weather-endpoint.ts'
import type { ApiHandler } from '../interface/http/api.ts'
import type { Logger } from '../observability/logger.ts'
import { createCircuitBreaker, type CircuitBreaker } from '../resilience/circuit-breaker.ts'
import { createTimedCache } from '../resilience/timed-cache.ts'
import { withResilience } from '../resilience/with-resilience.ts'

export type AppDependencies = {
  readonly config: Config
  /** Injecte : en production `globalThis.fetch`, en test un double. */
  readonly fetch: FetchLike
  readonly clock: ClockPort
  readonly logger: Logger
}

export type App = {
  readonly handler: ApiHandler
}

const isOutage = (failure: DependencyFailure | PlaceNotFound): boolean =>
  failure.kind === 'dependency-failure'

/**
 * Racine de composition : le seul endroit du projet qui connait les
 * implementations concretes.
 *
 * Partout ailleurs, les modules recoivent des interfaces. Ici on decide *qui*
 * les remplit : Nominatim plutot qu'un autre geocodeur, un cache en memoire
 * plutot qu'un Redis, `fetch` plutot qu'autre chose. Remplacer l'une de ces
 * briques ne demande de modifier que ce fichier.
 *
 * Elle joue le role du conteneur IoC vu en cours -- en trente lignes de code
 * explicite plutot qu'avec une librairie de plus. Les durees de vie sont
 * lisibles a l'oeil nu : tout ce qui est cree ici est un singleton porte par
 * l'application, et rien n'est partage entre deux appels a `createApp`, ce qui
 * rend le piege de la dependance captive impossible.
 */
export const createApp = (deps: AppDependencies): App => {
  const http = createFetchHttpClient({ fetch: deps.fetch })

  const breakers: Record<'geocoding' | 'forecast', CircuitBreaker> = {
    geocoding: createCircuitBreaker({ clock: deps.clock, ...deps.config.breaker }),
    forecast: createCircuitBreaker({ clock: deps.clock, ...deps.config.breaker }),
  }

  // Chaque dependance externe a son propre cache et son propre disjoncteur :
  // une panne du geocodage ne doit jamais couper l'acces aux previsions.
  const geocoding: GeocodingPort = {
    locate: withResilience<Parameters<GeocodingPort['locate']>[0], Place, DependencyFailure | PlaceNotFound>(
      createNominatimGeocoder({
        http,
        baseUrl: deps.config.geocoding.baseUrl,
        userAgent: deps.config.geocoding.userAgent,
        timeoutMs: deps.config.geocoding.timeoutMs,
      }),
      {
        cache: createTimedCache<Place>({ clock: deps.clock, ...deps.config.cache }),
        breaker: breakers.geocoding,
        keyOf: (address) => address.toLowerCase(),
        isOutage,
        circuitOpenError: () => circuitOpen('geocoding'),
      },
    ),
  }

  const forecast: ForecastPort = {
    forecastAt: withResilience<Coordinates, Forecast, DependencyFailure>(
      createOpenMeteoForecaster({
        http,
        baseUrl: deps.config.forecast.baseUrl,
        timeoutMs: deps.config.forecast.timeoutMs,
      }),
      {
        cache: createTimedCache<Forecast>({ clock: deps.clock, ...deps.config.cache }),
        breaker: breakers.forecast,
        keyOf: ({ latitude, longitude }) => `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
        isOutage: () => true,
        circuitOpenError: () => circuitOpen('forecast'),
      },
    ),
  }

  const probe = (): readonly DependencyStatus[] => [
    { name: 'nominatim', dependency: 'geocoding', circuit: breakers.geocoding.state() },
    { name: 'open-meteo', dependency: 'forecast', circuit: breakers.forecast.state() },
  ]

  deps.logger.log('info', 'app.composed', {
    geocoding: deps.config.geocoding.baseUrl,
    forecast: deps.config.forecast.baseUrl,
  })

  return {
    handler: createRouter([
      {
        method: 'GET',
        path: '/weather',
        handler: createWeatherEndpoint(createGetWeatherForAddress({ geocoding, forecast })),
      },
      { method: 'GET', path: '/health', handler: createHealthEndpoint(probe) },
    ]),
  }
}
