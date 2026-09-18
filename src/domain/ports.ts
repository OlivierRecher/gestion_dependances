import type { Address } from './address.ts'
import type { DependencyFailure, PlaceNotFound } from './failures.ts'
import type { Coordinates, Sourced, Forecast, Place } from './model.ts'
import type { Result } from './result.ts'

/** Ports attendus par le metier : les adaptateurs en dependent, jamais l'inverse. */
export interface GeocodingPort {
  locate(address: Address): Promise<Result<Sourced<Place>, DependencyFailure | PlaceNotFound>>
}

export interface ForecastPort {
  forecastAt(coordinates: Coordinates): Promise<Result<Sourced<Forecast>, DependencyFailure>>
}

/** L'horloge est une dependance cachee : on la rend explicite et injectable. */
export interface ClockPort {
  now(): number
}

/** Contrat brut d'un adaptateur, avant cache et circuit breaker (voir with-resilience). */
export interface GeocodingService {
  locate(address: Address): Promise<Result<Place, DependencyFailure | PlaceNotFound>>
}

export interface ForecastService {
  forecastAt(coordinates: Coordinates): Promise<Result<Forecast, DependencyFailure>>
}
