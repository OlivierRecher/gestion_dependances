import type { Coordinates } from './coordinates.ts'

export type { Coordinates } from './coordinates.ts'

/** live: reponse directe, cached: servie depuis le cache, stale: cache perime en mode degrade. */
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
