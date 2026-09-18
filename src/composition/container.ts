import { createGetWeatherForAddress } from '../application/get-weather-for-address.ts'
import type { Address } from '../domain/address.ts'
import type { Config } from '../config/config.ts'
import type { DependencyFailure, PlaceNotFound } from '../domain/failures.ts'
import type { Coordinates, Forecast, Place } from '../domain/model.ts'
import type { ClockPort, ForecastPort, GeocodingPort } from '../domain/ports.ts'
import { createOpenMeteoForecaster } from '../infrastructure/forecast/open-meteo-forecaster.ts'
import { createNominatimGeocoder } from '../infrastructure/geocoding/nominatim-geocoder.ts'
import { createFetchHttpClient, type FetchLike } from '../infrastructure/http/fetch-http-client.ts'
import { circuitOpen } from '../infrastructure/http/failure-mapping.ts'
import { createHealthEndpoint } from '../interface/http/health-endpoint.ts'
import { createRouter } from '../interface/http/router.ts'
import { createWeatherEndpoint } from '../interface/http/weather-endpoint.ts'
import type { ApiHandler } from '../interface/http/api.ts'
import type { Logger } from '../observability/logger.ts'
import { createCircuitBreaker } from '../resilience/circuit-breaker.ts'
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

/** Racine de composition : seul endroit qui choisit les implementations concretes. */
export const createApp = (deps: AppDependencies): App => {
  const http = createFetchHttpClient({ fetch: deps.fetch })
  const geocoder = createNominatimGeocoder({ http, ...deps.config.geocoding })
  const forecaster = createOpenMeteoForecaster({ http, ...deps.config.forecast })

  // Cache et disjoncteur separes par dependance : une panne du geocodage ne coupe pas les previsions.
  const geocodingBreaker = createCircuitBreaker({ clock: deps.clock, ...deps.config.breaker })
  const forecastBreaker = createCircuitBreaker({ clock: deps.clock, ...deps.config.breaker })

  const geocoding: GeocodingPort = {
    locate: withResilience<Address, Place, DependencyFailure | PlaceNotFound>(
      (address) => geocoder.locate(address),
      {
        cache: createTimedCache<Place>({ clock: deps.clock, ...deps.config.cache }),
        breaker: geocodingBreaker,
        keyOf: (address) => address.toLowerCase(),
        isOutage: (failure) => failure.kind === 'dependency-failure',
        circuitOpenError: () => circuitOpen('geocoding'),
      },
    ),
  }

  const forecast: ForecastPort = {
    forecastAt: withResilience<Coordinates, Forecast, DependencyFailure>(
      (coordinates) => forecaster.forecastAt(coordinates),
      {
        cache: createTimedCache<Forecast>({ clock: deps.clock, ...deps.config.cache }),
        breaker: forecastBreaker,
        keyOf: ({ latitude, longitude }) => `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
        isOutage: () => true,
        circuitOpenError: () => circuitOpen('forecast'),
      },
    ),
  }

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
      {
        method: 'GET',
        path: '/health',
        handler: createHealthEndpoint(() => [
          { name: 'nominatim', dependency: 'geocoding', circuit: geocodingBreaker.state() },
          { name: 'open-meteo', dependency: 'forecast', circuit: forecastBreaker.state() },
        ]),
      },
    ]),
  }
}
