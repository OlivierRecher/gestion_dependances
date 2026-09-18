import type { DependencyFailure, DependencyName } from '../../domain/failures.ts'
import type { HttpFailure } from './http-client.ts'

const failure = (
  dependency: DependencyName,
  reason: DependencyFailure['reason'],
  detail?: string,
): DependencyFailure => ({
  kind: 'dependency-failure',
  dependency,
  reason,
  ...(detail === undefined ? {} : { detail }),
})

/** Panne de transport -> vocabulaire du domaine. */
export const fromHttpFailure = (
  dependency: DependencyName,
  httpFailure: HttpFailure,
): DependencyFailure =>
  httpFailure.kind === 'http-timeout'
    ? failure(dependency, 'timeout')
    : failure(dependency, 'unreachable', httpFailure.detail)

/** Statut HTTP -> vocabulaire du domaine. `undefined` si la reponse est exploitable. */
export const fromStatus = (
  dependency: DependencyName,
  status: number,
): DependencyFailure | undefined => {
  if (status >= 200 && status < 300) return undefined
  if (status === 429) return failure(dependency, 'rate-limited', `HTTP ${status}`)
  return failure(dependency, 'upstream-error', `HTTP ${status}`)
}

/** Le fournisseur a repondu, mais pas ce que son contrat annonce. */
export const invalidResponse = (dependency: DependencyName, detail: string): DependencyFailure =>
  failure(dependency, 'invalid-response', detail)

export const circuitOpen = (dependency: DependencyName): DependencyFailure =>
  failure(dependency, 'circuit-open')
