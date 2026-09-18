import { neverThrows, type Logger } from './logger.ts'

/**
 * Sous-ensemble de `process` dont nous avons besoin. Le declarer permet
 * d'installer et de tester les gardes sans toucher au processus reel.
 */
export interface CrashSignals {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (reason: unknown) => void): void
}

const describe = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason)

/**
 * Dernier rempart contre la mort du processus.
 *
 * Ce n'est pas le correctif principal -- celui-ci consiste a ce qu'aucune
 * couche ne laisse fuir d'exception. C'est le filet en dessous, et les deux
 * cas ne se traitent pas de la meme facon :
 *
 * - une promesse rejetee non rattrapee est le plus souvent localisee : la
 *   journaliser et continuer vaut mieux que de couper un service qui repond
 *   encore a toutes ses autres requetes ;
 * - une exception non rattrapee laisse le processus dans un etat inconnu.
 *   Poursuivre reviendrait a servir des reponses dont on ne peut plus
 *   garantir la justesse. On ferme proprement et on laisse le superviseur
 *   redemarrer.
 */
export const installCrashGuards = (
  target: CrashSignals,
  logger: Logger,
  onFatal: () => void,
): void => {
  const safeLogger = neverThrows(logger)

  target.on('unhandledRejection', (reason) => {
    safeLogger.log('error', 'process.unhandled-rejection', { reason: describe(reason) })
  })

  target.on('uncaughtException', (error) => {
    safeLogger.log('error', 'process.uncaught-exception', { error: describe(error) })
    onFatal()
  })
}
