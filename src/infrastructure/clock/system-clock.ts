import type { ClockPort } from '../../domain/ports.ts'

/**
 * Implementation reelle de l'horloge. C'est le seul endroit du code de
 * production qui appelle `Date.now()` : partout ailleurs, le temps arrive par
 * injection, donc se controle en test.
 */
export const systemClock: ClockPort = {
  now: () => Date.now(),
}
