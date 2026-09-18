import { neverThrows, type Logger } from './logger.ts'

/** Sous-ensemble de `process` necessaire, pour tester les gardes sans processus reel. */
export interface CrashSignals {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (reason: unknown) => void): void
}

const describe = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason)

/**
 * Dernier rempart contre la mort du processus : une rejection non rattrapee se
 * journalise et continue, une exception non rattrapee force un arret propre.
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
