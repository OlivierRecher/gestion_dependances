import type { ClockPort } from '../domain/ports.ts'

export type CachedFreshness = 'cached' | 'stale'

export type CacheHit<T> = {
  readonly value: T
  readonly freshness: CachedFreshness
}

export type TimedCacheOptions = {
  readonly clock: ClockPort
  /** Duree pendant laquelle l'entree est consideree fraiche. */
  readonly ttlMs: number
  /** Duree totale de conservation ; au-dela du TTL l'entree est servie perimee. */
  readonly staleTtlMs: number
  /** Plafond du nombre d'entrees, pour ne pas transformer le cache en fuite memoire. */
  readonly maxEntries: number
}

export interface TimedCache<T> {
  read(key: string): CacheHit<T> | undefined
  write(key: string, value: T): void
  size(): number
}

/**
 * Cache TTL avec conservation des donnees perimees.
 *
 * L'interet n'est pas la performance mais la disponibilite : quand un service
 * externe tombe, une donnee perimee vaut mieux qu'une erreur. La distinction
 * `cached` / `stale` remonte jusqu'a la reponse HTTP, ou elle devient le
 * drapeau `degraded`.
 *
 * `Map` conserve l'ordre d'insertion : reinserer une cle lue suffit a obtenir
 * une eviction LRU sans structure de donnees supplementaire.
 */
export const createTimedCache = <T>(options: TimedCacheOptions): TimedCache<T> => {
  const entries = new Map<string, { value: T; storedAt: number }>()

  const evictOldestIfFull = (): void => {
    while (entries.size >= options.maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done === true) return
      entries.delete(oldest.value)
    }
  }

  return {
    read: (key) => {
      const entry = entries.get(key)
      if (entry === undefined) return undefined

      const age = options.clock.now() - entry.storedAt
      if (age >= options.staleTtlMs) {
        entries.delete(key)
        return undefined
      }

      // Marque l'entree comme recemment utilisee.
      entries.delete(key)
      entries.set(key, entry)

      return { value: entry.value, freshness: age >= options.ttlMs ? 'stale' : 'cached' }
    },

    write: (key, value) => {
      entries.delete(key)
      evictOldestIfFull()
      entries.set(key, { value, storedAt: options.clock.now() })
    },

    size: () => entries.size,
  }
}
