import type { Address } from './address.ts'
import type { DependencyFailure, PlaceNotFound } from './failures.ts'
import type { Coordinates, Sourced, Forecast, Place } from './model.ts'
import type { Result } from './result.ts'

/**
 * Ports : les interfaces que le metier attend. Ce sont elles qui inversent le
 * controle -- le cas d'usage depend de ces contrats, jamais de Nominatim ni
 * d'Open-Meteo. Les adaptateurs (infrastructure) dependent du domaine, pas
 * l'inverse : la fleche de dependance pointe toujours vers le metier.
 */
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

/**
 * Adaptateurs bruts : le contrat qu'implementent les fournisseurs externes,
 * avant toute politique de resilience. Les separer des ports permet
 * d'appliquer cache et circuit breaker depuis l'exterieur, sans qu'un
 * adaptateur ait a en connaitre l'existence.
 */
export type Geocoder = (
  address: Address,
) => Promise<Result<Place, DependencyFailure | PlaceNotFound>>

export type Forecaster = (
  coordinates: Coordinates,
) => Promise<Result<Forecast, DependencyFailure>>
