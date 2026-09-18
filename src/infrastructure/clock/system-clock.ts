import type { ClockPort } from '../../domain/ports.ts'

/** Seul endroit du code de production qui appelle `Date.now()`. */
export const systemClock: ClockPort = {
  now: () => Date.now(),
}
