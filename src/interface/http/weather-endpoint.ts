import type { GetWeatherForAddress, WeatherReport } from '../../application/get-weather-for-address.ts'
import { createAddress } from '../../domain/address.ts'
import type { DependencyFailure, ForecastUnavailable, PlaceNotFound } from '../../domain/failures.ts'
import type { Place } from '../../domain/model.ts'
import { jsonResponse, problemResponse, type ApiHandler, type ApiResponse } from './api.ts'

const REASON_LABELS: Readonly<Record<DependencyFailure['reason'], string>> = {
  timeout: 'timeout',
  unreachable: 'service injoignable',
  'upstream-error': 'erreur du fournisseur',
  'invalid-response': 'reponse inexploitable',
  'rate-limited': 'quota depasse',
  'circuit-open': 'circuit ouvert apres des pannes repetees',
}

const DEPENDENCY_LABELS: Readonly<Record<DependencyFailure['dependency'], string>> = {
  geocoding: 'Le service de geocodage',
  forecast: 'Le service de previsions',
}

/** DTO public, distinct de `Place` : le contrat expose ne doit pas bouger avec le domaine. */
const toLocationDto = (place: Place) => ({
  label: place.label,
  latitude: place.coordinates.latitude,
  longitude: place.coordinates.longitude,
})

const toReportDto = (report: WeatherReport) => ({
  address: report.address,
  location: toLocationDto(report.place),
  forecast: {
    timezone: report.forecast.timezone,
    hourly: report.forecast.samples.map((sample) => ({
      time: sample.time,
      shortwaveRadiation: sample.shortwaveRadiation,
    })),
  },
  meta: {
    degraded: report.degraded,
    sources: report.sources,
  },
})

/** Une reponse degradee reste utile mais ne doit pas finir dans un cache partage. */
const degradationHeaders = (report: WeatherReport): Readonly<Record<string, string>> =>
  report.degraded
    ? { Warning: '110 - "Response is stale"', 'Cache-Control': 'no-store' }
    : {}

const missingAddress = (): ApiResponse =>
  problemResponse({
    type: 'urn:api-meteo:invalid-address',
    title: 'Adresse invalide',
    status: 400,
    detail: 'Le parametre de requete "address" est obligatoire et doit faire de 1 a 256 caracteres.',
  })

const placeNotFound = (failure: PlaceNotFound): ApiResponse =>
  problemResponse({
    type: 'urn:api-meteo:place-not-found',
    title: 'Lieu introuvable',
    status: 404,
    detail: `Aucun lieu ne correspond a "${failure.address}".`,
  })

const dependencyUnavailable = (
  failure: DependencyFailure,
  extensions: Readonly<Record<string, unknown>>,
): ApiResponse =>
  problemResponse(
    {
      type: 'urn:api-meteo:dependency-unavailable',
      title: failure.dependency === 'forecast' ? 'Previsions indisponibles' : 'Geocodage indisponible',
      status: 503,
      detail: `${DEPENDENCY_LABELS[failure.dependency]} est indisponible (${REASON_LABELS[failure.reason]}).`,
    },
    { dependency: failure.dependency, ...extensions },
    { 'Cache-Control': 'no-store' },
  )

const forecastUnavailable = (failure: ForecastUnavailable): ApiResponse =>
  dependencyUnavailable(failure.cause, {
    location: toLocationDto(failure.place),
    meta: {
      degraded: true,
      sources: { geocoding: failure.geocoding, forecast: 'unavailable' },
    },
  })

const geocodingUnavailable = (failure: DependencyFailure): ApiResponse =>
  dependencyUnavailable(failure, {
    meta: {
      degraded: true,
      sources: { geocoding: 'unavailable', forecast: 'unavailable' },
    },
  })

/** Endpoint `GET /weather?address=...` : ne depend que du cas d'usage injecte. */
export const createWeatherEndpoint = (getWeather: GetWeatherForAddress): ApiHandler =>
  async (request) => {
    const address = createAddress(request.query['address'] ?? '')
    if (!address.ok) return missingAddress()

    const result = await getWeather(address.value)

    if (result.ok) {
      return jsonResponse(200, toReportDto(result.value), degradationHeaders(result.value))
    }

    switch (result.error.kind) {
      case 'place-not-found':
        return placeNotFound(result.error)
      case 'forecast-unavailable':
        return forecastUnavailable(result.error)
      case 'dependency-failure':
        return geocodingUnavailable(result.error)
    }
  }
