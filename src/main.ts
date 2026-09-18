import { createApp } from './composition/container.ts'
import { loadConfig } from './config/config.ts'
import { systemClock } from './infrastructure/clock/system-clock.ts'
import { startHttpServer, type RunningServer } from './interface/http/server.ts'
import { installCrashGuards } from './observability/crash-guards.ts'
import { createJsonLogger, neverThrows, type LogSink } from './observability/logger.ts'

/**
 * Construit le puits de journalisation.
 *
 * `process.stdout.write` est **asynchrone** quand la sortie est un tuyau : si
 * le lecteur se ferme (`node src/main.ts | head -1`, un agent de collecte qui
 * redemarre), l'echec ne remonte pas par une exception mais par un evenement
 * 'error' sur le flux. Sans ecouteur, Node en fait une exception non
 * rattrapee, et l'API meurt parce que personne ne lisait ses logs.
 *
 * L'ecouteur ci-dessous est donc le vrai correctif : aucun try/catch, si bien
 * place soit-il, n'aurait pu intercepter cette erreur.
 */
const createStdoutSink = (): LogSink => {
  process.stdout.on('error', () => {
    // Tuyau ferme : on perd les journaux, pas le service.
  })

  return (line) => process.stdout.write(`${line}\n`)
}

/**
 * Point d'entree : la seule fonction du projet qui touche `process`, l'horloge
 * systeme et le `fetch` global.
 *
 * Tout le reste de l'application recoit ces elements par injection. C'est ce
 * qui permet aux tests de bout en bout de monter exactement la meme
 * application, avec un temps et un reseau sous controle.
 */
const main = async (): Promise<void> => {
  const logger = neverThrows(createJsonLogger(createStdoutSink(), () => new Date()))

  // Installes avant toute autre chose : un garde pose trop tard ne protege
  // pas le demarrage, qui est justement le moment ou l'on journalise le plus.
  let server: RunningServer | undefined

  const shutdown = (reason: string): void => {
    logger.log('info', 'server.stopping', { reason })
    void server?.close().then(() => {
      logger.log('info', 'server.stopped')
    })
  }

  installCrashGuards(process, logger, () => {
    // L'etat du processus n'est plus fiable : on rend la main au superviseur
    // plutot que de continuer a servir des reponses douteuses.
    process.exitCode = 1
    shutdown('uncaughtException')
  })

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

  server = await startHttpServer({
    handler: app.handler,
    port: config.value.port,
    logger,
  })

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

await main()
