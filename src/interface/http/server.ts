import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { neverThrows, type Logger } from '../../observability/logger.ts'
import { PROBLEM_CONTENT_TYPE, type ApiHandler, type ApiRequest, type ApiResponse } from './api.ts'

export type HttpServerOptions = {
  readonly handler: ApiHandler
  /** `0` laisse le systeme choisir un port libre : indispensable en test. */
  readonly port: number
  readonly logger: Logger
  readonly host?: string
}

export type RunningServer = {
  readonly port: number
  close(): Promise<void>
}

const DEFAULT_HOST = '127.0.0.1'

/** Premiere valeur pour chaque parametre : `?a=1&a=2` ne doit pas produire un tableau surprise. */
const toApiRequest = (message: IncomingMessage): ApiRequest => {
  const url = new URL(message.url ?? '/', 'http://localhost')
  const query: Record<string, string> = {}

  for (const [key, value] of url.searchParams) {
    query[key] ??= value
  }

  return { method: message.method ?? 'GET', path: url.pathname, query }
}

const INTERNAL_ERROR: ApiResponse = {
  status: 500,
  headers: { 'Content-Type': PROBLEM_CONTENT_TYPE },
  body: {
    type: 'urn:api-meteo:internal-error',
    title: 'Erreur interne',
    status: 500,
    detail: 'La requete n a pas pu etre traitee.',
  },
}

/**
 * Execute une action dont l'echec ne doit jamais remonter.
 *
 * Utilise uniquement sur les chemins de derniere chance, la ou lever
 * signifierait tuer le processus au lieu de degrader une seule requete.
 */
const failSafe = (action: () => void): void => {
  try {
    action()
  } catch {
    // Volontairement silencieux : c'est deja le chemin de recuperation.
  }
}

const send = (message: IncomingMessage, response: ServerResponse, api: ApiResponse): void => {
  const payload = Buffer.from(JSON.stringify(api.body ?? null), 'utf8')

  response.writeHead(api.status, {
    ...api.headers,
    'Content-Length': String(payload.byteLength),
  })

  // Un HEAD porte les memes en-tetes qu'un GET, mais jamais de corps.
  response.end(message.method?.toUpperCase() === 'HEAD' ? undefined : payload)
}

/**
 * Adaptateur de transport : traduit `node:http` vers le contrat `ApiHandler`.
 *
 * Toute la logique HTTP -- codes, en-tetes, corps -- vit dans les endpoints,
 * qui sont des fonctions pures. Ce fichier ne fait que brancher des tuyaux,
 * c'est pourquoi il est le seul a importer `node:http`. Passer a un autre
 * serveur ne demanderait de reecrire que lui.
 */
export const startHttpServer = (options: HttpServerOptions): Promise<RunningServer> => {
  // Le transport ne doit pas pouvoir etre tue par la journalisation, quel que
  // soit le logger que l'appelant lui confie.
  const logger = neverThrows(options.logger)

  const server = createServer((message, response) => {
    void (async () => {
      try {
        send(message, response, await options.handler(toApiRequest(message)))
      } catch (error: unknown) {
        // Le chemin de recuperation doit etre aussi solide que le chemin
        // nominal : journaliser, puis repondre, puis abandonner la socket --
        // chaque etape isolee, aucune ne pouvant emporter le processus.
        failSafe(() =>
          logger.log('error', 'request.unhandled', {
            path: message.url,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        failSafe(() => {
          if (!response.headersSent) send(message, response, INTERNAL_ERROR)
          else response.end()
        })
        failSafe(() => {
          if (!response.writableEnded) response.destroy()
        })
      }
    })()
  })

  // Une erreur de socket apres le demarrage (EMFILE, ECONNRESET...) emet un
  // evenement 'error' : sans ecouteur, Node le transforme en exception non
  // rattrapee et le processus meurt.
  server.on('error', (error) => {
    logger.log('error', 'server.error', { error: error.message })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host ?? DEFAULT_HOST, () => {
      server.removeListener('error', reject)
      const address = server.address() as AddressInfo

      logger.log('info', 'server.started', { port: address.port })

      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((error) => (error === undefined ? done() : fail(error)))
            server.closeAllConnections()
          }),
      })
    })
  })
}
