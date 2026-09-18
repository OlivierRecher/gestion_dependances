import type { Freshness, Place } from './model.ts'

export type DependencyName = 'geocoding' | 'forecast'

export type FailureReason =
  | 'timeout'
  | 'unreachable'
  | 'upstream-error'
  | 'invalid-response'
  | 'rate-limited'
  | 'circuit-open'

/**
 * Panne d'une dependance externe, exprimee en vocabulaire metier.
 * Aucun code HTTP, aucun type issu de `fetch` : les adaptateurs traduisent
 * leurs erreurs techniques vers ce type. Si l'on change de client HTTP ou de
 * fournisseur, ce type ne bouge pas.
 */
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

/**
 * Le lieu a bien ete resolu mais la meteo est introuvable : on remonte quand
 * meme le resultat partiel pour que l'appelant ne reparte pas les mains vides.
 */
export type ForecastUnavailable = {
  readonly kind: 'forecast-unavailable'
  readonly place: Place
  readonly geocoding: Freshness
  readonly cause: DependencyFailure
}

export type WeatherFailure = DependencyFailure | PlaceNotFound | ForecastUnavailable
