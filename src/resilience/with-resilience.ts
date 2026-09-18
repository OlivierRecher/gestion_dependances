import type { Sourced } from '../domain/model.ts'
import { err, ok, type Result } from '../domain/result.ts'
import type { CircuitBreaker } from './circuit-breaker.ts'
import type { TimedCache } from './timed-cache.ts'

export type ResilienceOptions<A, T, E> = {
  readonly cache: TimedCache<T>
  readonly breaker: CircuitBreaker
  /** Cle de cache derivee de l'argument d'appel. */
  readonly keyOf: (arg: A) => string
  /**
   * Distingue une panne du service (qui doit ouvrir le circuit) d'une reponse
   * metier negative (le service va bien, il repond simplement "non").
   * Confondre les deux ferait sauter le circuit sur des adresses inconnues.
   */
  readonly isOutage: (error: E) => boolean
  /** Erreur a renvoyer quand le circuit est ouvert et qu'aucun secours n'existe. */
  readonly circuitOpenError: () => E
}

/**
 * Enveloppe un appel sortant de timeouts logiques : cache frais, circuit
 * breaker, et repli sur donnee perimee.
 *
 * Generique a dessein : le decorateur ne sait rien de la meteo ni du geocodage.
 * On l'applique aux deux dependances externes depuis la racine de composition,
 * et aucun des deux adaptateurs n'a besoin d'etre modifie -- c'est la meme
 * politique de resilience, ecrite et testee une seule fois.
 */
export const withResilience = <A, T, E>(
  upstream: (arg: A) => Promise<Result<T, E>>,
  options: ResilienceOptions<A, T, E>,
) => async (arg: A): Promise<Result<Sourced<T>, E>> => {
  const key = options.keyOf(arg)

  const cached = options.cache.read(key)
  if (cached?.freshness === 'cached') {
    return ok({ data: cached.value, freshness: 'cached' })
  }

  const serveStale = (): Result<Sourced<T>, E> | undefined =>
    cached === undefined ? undefined : ok({ data: cached.value, freshness: 'stale' })

  if (!options.breaker.canAttempt()) {
    return serveStale() ?? err(options.circuitOpenError())
  }

  const result = await upstream(arg)

  if (result.ok) {
    options.breaker.recordSuccess()
    options.cache.write(key, result.value)
    return ok({ data: result.value, freshness: 'live' })
  }

  if (!options.isOutage(result.error)) {
    // Le service a repondu : il est sain, seule la reponse est negative.
    options.breaker.recordSuccess()
    return err(result.error)
  }

  options.breaker.recordFailure()
  return serveStale() ?? err(result.error)
}
