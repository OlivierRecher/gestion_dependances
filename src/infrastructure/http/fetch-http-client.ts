import { err, ok } from '../../domain/result.ts'
import type { HttpClient } from './http-client.ts'

/** Signature minimale de `fetch`, pour pouvoir l'injecter en test. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export type FetchHttpClientDeps = {
  readonly fetch: FetchLike
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Seul fichier du projet qui touche `fetch`, injecte plutot que lu depuis le global. */
export const createFetchHttpClient = (deps: FetchHttpClientDeps): HttpClient => ({
  get: async (request) => {
    try {
      const response = await deps.fetch(request.url, {
        method: 'GET',
        signal: AbortSignal.timeout(request.timeoutMs),
        ...(request.headers === undefined ? {} : { headers: request.headers }),
      })

      return ok({ status: response.status, body: await response.text() })
    } catch (error: unknown) {
      return isAbort(error)
        ? err({ kind: 'http-timeout' })
        : err({ kind: 'http-network', detail: describe(error) })
    }
  },
})
