import type { ClockPort } from '../domain/ports.ts'

export type CircuitState = 'closed' | 'open' | 'half-open'

export type CircuitBreakerOptions = {
  readonly clock: ClockPort
  /** Nombre d'echecs consecutifs avant ouverture. */
  readonly failureThreshold: number
  /** Duree pendant laquelle le circuit reste ouvert avant de retenter. */
  readonly resetTimeoutMs: number
}

export interface CircuitBreaker {
  state(): CircuitState
  /** Consomme le droit d'appeler. En semi-ouvert, une seule sonde passe. */
  canAttempt(): boolean
  recordSuccess(): void
  recordFailure(): void
}

/**
 * Circuit breaker : empeche de marteler un service deja tombe.
 *
 * C'est une machine a etats pure -- pas de timer, pas de `setTimeout`, pas
 * d'appel reseau. Tout le temps passe par `ClockPort`, ce qui la rend testable
 * a l'unite en quelques microsecondes, et reutilisable pour n'importe quelle
 * dependance.
 */
export const createCircuitBreaker = (options: CircuitBreakerOptions): CircuitBreaker => {
  let consecutiveFailures = 0
  let openedAt: number | null = null
  let probeInFlight = false

  const state = (): CircuitState => {
    if (openedAt === null) return 'closed'
    const elapsed = options.clock.now() - openedAt
    return elapsed >= options.resetTimeoutMs ? 'half-open' : 'open'
  }

  return {
    state,

    canAttempt: () => {
      switch (state()) {
        case 'closed':
          return true
        case 'open':
          return false
        case 'half-open': {
          if (probeInFlight) return false
          probeInFlight = true
          return true
        }
      }
    },

    recordSuccess: () => {
      consecutiveFailures = 0
      openedAt = null
      probeInFlight = false
    },

    recordFailure: () => {
      probeInFlight = false

      if (state() === 'half-open') {
        openedAt = options.clock.now()
        return
      }

      consecutiveFailures += 1
      if (consecutiveFailures >= options.failureThreshold) {
        openedAt = options.clock.now()
      }
    },
  }
}
