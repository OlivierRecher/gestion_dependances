import type { DependencyName } from '../../domain/failures.ts'
import { jsonResponse, type ApiHandler } from './api.ts'

/** Etat de disjoncteur expose publiquement, redeclare pour ne pas dependre d'un type interne. */
export type CircuitReport = 'closed' | 'open' | 'half-open'

export type DependencyStatus = {
  readonly name: string
  readonly dependency: DependencyName
  readonly circuit: CircuitReport
}

/** Sonde synchrone : lire un etat de circuit n'appelle aucun service externe. */
export type HealthProbe = () => readonly DependencyStatus[]

/**
 * Endpoint `GET /health` : renvoie toujours 200, meme circuits ouverts (l'API
 * sert encore du cache), et n'appelle jamais les services externes lui-meme.
 */
export const createHealthEndpoint = (probe: HealthProbe): ApiHandler => () => {
  const dependencies = probe().map((status) => ({
    ...status,
    healthy: status.circuit === 'closed',
  }))

  const status = dependencies.every((dependency) => dependency.healthy) ? 'ok' : 'degraded'

  return Promise.resolve(
    jsonResponse(200, { status, dependencies }, { 'Cache-Control': 'no-store' }),
  )
}
