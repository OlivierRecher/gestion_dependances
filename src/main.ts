import { createApp } from './composition/container.ts'
import { loadConfig } from './config/config.ts'
import { systemClock } from './infrastructure/clock/system-clock.ts'
import { startHttpServer, type RunningServer } from './interface/http/server.ts'
import { installCrashGuards } from './observability/crash-guards.ts'
import { createJsonLogger, neverThrows, type LogSink } from './observability/logger.ts'

/** Si le lecteur de stdout se ferme, l'echec arrive en evenement 'error', pas en exception : sans ecouteur ici, Node tue le processus. */
const createStdoutSink = (): LogSink => {
  process.stdout.on('error', () => {
    // tuyau ferme : on perd les journaux, pas le service
  })

  return (line) => process.stdout.write(`${line}\n`)
}

/** Point d'entree : seule fonction du projet a toucher `process`, l'horloge systeme et `fetch`. */
const main = async (): Promise<void> => {
  const logger = neverThrows(createJsonLogger(createStdoutSink(), () => new Date()))

  let server: RunningServer | undefined

  const shutdown = (reason: string): void => {
    logger.log('info', 'server.stopping', { reason })
    void server?.close().then(() => {
      logger.log('info', 'server.stopped')
    })
  }

  installCrashGuards(process, logger, () => {
    process.exitCode = 1
    shutdown('uncaughtException')
  })

  const config = loadConfig(process.env)

  if (!config.ok) {
    for (const issue of config.error.issues) {
      logger.log('error', 'config.invalid', { issue })
    }
    process.exitCode = 1
    return
  }

  const app = createApp({
    config: config.value,
    fetch: globalThis.fetch,
    clock: systemClock,
    logger,
  })

  server = await startHttpServer({
    handler: app.handler,
    port: config.value.port,
    logger,
  })

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

await main()
