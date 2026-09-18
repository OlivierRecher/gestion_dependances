import { createApp } from './composition/container.ts'
import { loadConfig } from './config/config.ts'
import { systemClock } from './infrastructure/clock/system-clock.ts'
import { startHttpServer } from './interface/http/server.ts'
import { createJsonLogger } from './observability/logger.ts'

/**
 * Point d'entree : la seule fonction du projet qui touche `process`, l'horloge
 * systeme et le `fetch` global.
 *
 * Tout le reste de l'application recoit ces elements par injection. C'est ce
 * qui permet aux tests de bout en bout de monter exactement la meme
 * application, avec un temps et un reseau sous controle.
 */
const main = async (): Promise<void> => {
  const logger = createJsonLogger((line) => process.stdout.write(`${line}\n`), () => new Date())
  const config = loadConfig(process.env)

  if (!config.ok) {
    // Echouer au demarrage, jamais a la premiere requete.
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

  const server = await startHttpServer({
    handler: app.handler,
    port: config.value.port,
    logger,
  })

  const shutdown = (signal: string): void => {
    logger.log('info', 'server.stopping', { signal })
    void server.close().then(() => {
      logger.log('info', 'server.stopped')
    })
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

await main()
