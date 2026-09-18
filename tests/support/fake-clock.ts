import type { ClockPort } from '../../src/domain/ports.ts'

export type FakeClock = ClockPort & {
  advance(milliseconds: number): void
}

/**
 * L'horloge est une dependance cachee classique : injectee, elle rend les
 * tests de TTL et de circuit breaker deterministes et instantanes.
 */
export const fakeClock = (start = 1_000_000): FakeClock => {
  let current = start
  return {
    now: () => current,
    advance: (milliseconds) => {
      current += milliseconds
    },
  }
}
