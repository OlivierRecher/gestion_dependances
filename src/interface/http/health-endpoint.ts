import type { DependencyName } from '../../domain/failures.ts'
import { jsonResponse, type ApiHandler } from './api.ts'

/**
 * Etat de disjoncteur tel qu'il est *expose*. Volontairement redeclare plutot
 * qu'importe du module de resilience : le contrat public ne doit pas se
 * deformer parce qu'un type interne evolue.
 */
export type CircuitReport = 'closed' | 'open' | 'half-open'

export type DependencyStatus = {
  readonly name: string
  readonly dependency: DependencyName
  readonly circuit: CircuitReport
}

/** Sonde synchrone : lire un etat de circuit n'appelle aucun service externe. */
export type HealthProbe = () => readonly DependencyStatus[]

/**
 * Endpoint `GET /health`.
 *
 * Il renvoie toujours 200, meme avec des circuits ouverts. Ce n'est pas une
 * complaisance : l'API est reellement vivante et sait encore servir des
 * donnees en cache. La confondre avec ses dependances ferait redemarrer en
 * boucle un service parfaitement sain parce qu'un tiers est tombe.
 *
 * Et surtout, la sonde n'appelle pas les services externes : un `/health` qui
 * interroge ses dependances transforme la supervision en attaque par
 * amplification.
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
