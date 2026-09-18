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

/** Execute une action de derniere chance dont l'echec ne doit jamais tuer le processus. */
const failSafe = (action: () => void): void => {
  try {
    action()
  } catch {
    // deja le chemin de recuperation
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

/** Adaptateur de transport : traduit `node:http` vers `ApiHandler`. Seul fichier a importer `node:http`. */
export const startHttpServer = (options: HttpServerOptions): Promise<RunningServer> => {
  const logger = neverThrows(options.logger)

  const server = createServer((message, response) => {
    void (async () => {
      try {
        send(message, response, await options.handler(toApiRequest(message)))
      } catch (error: unknown) {
        // journaliser, repondre, abandonner la socket : chaque etape isolee des autres
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

  // sans ecouteur, une erreur de socket (EMFILE, ECONNRESET...) tue le processus
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
