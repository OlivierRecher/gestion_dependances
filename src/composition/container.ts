import { createGetWeatherForAddress } from '../application/get-weather-for-address.ts'
import type { Address } from '../domain/address.ts'
import type { Config } from '../config/config.ts'
import type { DependencyFailure, PlaceNotFound } from '../domain/failures.ts'
import type { Coordinates, Forecast, Place } from '../domain/model.ts'
import type { ClockPort, ForecastPort, ForecastService, GeocodingPort, GeocodingService } from '../domain/ports.ts'
import { createDemoForecaster } from '../infrastructure/demo/demo-forecaster.ts'
import { createDemoGeocoder } from '../infrastructure/demo/demo-geocoder.ts'
import { createMetNorwayForecaster } from '../infrastructure/forecast/met-norway-forecaster.ts'
import { createOpenMeteoForecaster } from '../infrastructure/forecast/open-meteo-forecaster.ts'
import { createBanGeocoder } from '../infrastructure/geocoding/ban-geocoder.ts'
import { createNominatimGeocoder } from '../infrastructure/geocoding/nominatim-geocoder.ts'
import { createFetchHttpClient, type FetchLike } from '../infrastructure/http/fetch-http-client.ts'
import { circuitOpen } from '../infrastructure/http/failure-mapping.ts'
import type { HttpClient } from '../infrastructure/http/http-client.ts'
import { createHealthEndpoint } from '../interface/http/health-endpoint.ts'
import { createRouter } from '../interface/http/router.ts'
import { createWeatherEndpoint } from '../interface/http/weather-endpoint.ts'
import type { ApiHandler, ApiRequest } from '../interface/http/api.ts'
import type { Logger } from '../observability/logger.ts'
import { createCircuitBreaker } from '../resilience/circuit-breaker.ts'
import { map } from '../domain/result.ts'
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

/** Choix du fournisseur de geocodage, configurable sans recompilation. */
const createGeocoder = (http: HttpClient, config: Config['geocoding']): GeocodingService => {
  switch (config.provider) {
    case 'nominatim':
      return createNominatimGeocoder({ http, baseUrl: config.baseUrl, userAgent: config.userAgent, timeoutMs: config.timeoutMs })
    case 'ban':
      return createBanGeocoder({ http, baseUrl: config.baseUrl, timeoutMs: config.timeoutMs })
  }
}

/** Choix du fournisseur de previsions, configurable sans recompilation. */
const createForecaster = (http: HttpClient, config: Config['forecast']): ForecastService => {
  switch (config.provider) {
    case 'open-meteo':
      return createOpenMeteoForecaster({ http, baseUrl: config.baseUrl, timeoutMs: config.timeoutMs })
    case 'met-norway':
      return createMetNorwayForecaster({ http, baseUrl: config.baseUrl, userAgent: config.userAgent, timeoutMs: config.timeoutMs })
  }
}

/** Le mode demo n'a ni cache ni disjoncteur : ses donnees sont toujours disponibles. */
const demoPorts = (clock: ClockPort): { geocoding: GeocodingPort; forecast: ForecastPort } => {
  const geocoder = createDemoGeocoder()
  const forecaster = createDemoForecaster(clock)
  return {
    geocoding: { locate: async (address) => map(await geocoder.locate(address), (data) => ({ data, freshness: 'live' as const })) },
    forecast: { forecastAt: async (coordinates) => map(await forecaster.forecastAt(coordinates), (data) => ({ data, freshness: 'live' as const })) },
  }
}

const isDemo = (request: ApiRequest): boolean => request.query['demo'] === 'true'

/** Racine de composition : seul endroit qui choisit les implementations concretes. */
export const createApp = (deps: AppDependencies): App => {
  const http = createFetchHttpClient({ fetch: deps.fetch })
  const geocoder = createGeocoder(http, deps.config.geocoding)
  const forecaster = createForecaster(http, deps.config.forecast)

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
    geocoding: `${deps.config.geocoding.provider} (${deps.config.geocoding.baseUrl})`,
    forecast: `${deps.config.forecast.provider} (${deps.config.forecast.baseUrl})`,
  })

  // Meme endpoint, meme cas d'usage : seuls les adaptateurs changent, donc la forme de la reponse aussi reste la meme.
  const liveWeather = createWeatherEndpoint(createGetWeatherForAddress({ geocoding, forecast }))
  const demoWeather = createWeatherEndpoint(createGetWeatherForAddress(demoPorts(deps.clock)))
  const weather: ApiHandler = (request) => (isDemo(request) ? demoWeather(request) : liveWeather(request))

  return {
    handler: createRouter([
      { method: 'GET', path: '/weather', handler: weather },
      { method: 'GET', path: '/forecast', handler: weather },
      {
        method: 'GET',
        path: '/health',
        handler: createHealthEndpoint(() => [
          { name: deps.config.geocoding.provider, dependency: 'geocoding', circuit: geocodingBreaker.state() },
          { name: deps.config.forecast.provider, dependency: 'forecast', circuit: forecastBreaker.state() },
        ]),
      },
    ]),
  }
}
