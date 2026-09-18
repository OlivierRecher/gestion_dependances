import type { Coordinates } from './coordinates.ts'

export type { Coordinates } from './coordinates.ts'

/**
 * Fraicheur d'une donnee obtenue aupres d'une dependance externe.
 * - `live`   : reponse directe du service
 * - `cached` : cache encore valide, le service n'a pas ete sollicite
 * - `stale`  : cache expire servi parce que le service est tombe (mode degrade)
 *
 * Cette information fait partie du contrat des ports : le metier doit pouvoir
 * distinguer une reponse fraiche d'un secours, sans savoir *comment* le cache
 * est implemente.
 */
export type Freshness = 'live' | 'cached' | 'stale'

/** Une donnee accompagnee de sa provenance. */
export type Sourced<T> = {
  readonly data: T
  readonly freshness: Freshness
}

/** Lieu resolu par le geocodage. */
export type Place = {
  readonly label: string
  readonly coordinates: Coordinates
}

/** Un point de mesure horaire. */
export type RadiationSample = {
  readonly time: string
  readonly shortwaveRadiation: number
}

/** Previsions pour un point donne. */
export type Forecast = {
  readonly coordinates: Coordinates
  readonly timezone: string
  readonly samples: readonly RadiationSample[]
}
