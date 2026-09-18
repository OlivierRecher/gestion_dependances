import type { Freshness, Place } from './model.ts'

export type DependencyName = 'geocoding' | 'forecast'

export type FailureReason =
  | 'timeout'
  | 'unreachable'
  | 'upstream-error'
  | 'invalid-response'
  | 'rate-limited'
  | 'circuit-open'

/** Panne d'une dependance externe, en vocabulaire metier : aucun code HTTP ici. */
export type DependencyFailure = {
  readonly kind: 'dependency-failure'
  readonly dependency: DependencyName
  readonly reason: FailureReason
  readonly detail?: string
}

export type PlaceNotFound = {
  readonly kind: 'place-not-found'
  readonly address: string
}

/** Lieu resolu mais meteo indisponible : le resultat partiel est renvoye quand meme. */
export type ForecastUnavailable = {
  readonly kind: 'forecast-unavailable'
  readonly place: Place
  readonly geocoding: Freshness
  readonly cause: DependencyFailure
}

export type WeatherFailure = DependencyFailure | PlaceNotFound | ForecastUnavailable
