import type { Result } from '../../domain/result.ts'

export type HttpRequest = {
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  /** Obligatoire : un appel sortant sans delai maximum est un SPOF en attente. */
  readonly timeoutMs: number
}

export type HttpResponse = {
  readonly status: number
  readonly body: string
}

export type HttpFailure =
  | { readonly kind: 'http-timeout' }
  | { readonly kind: 'http-network'; readonly detail: string }

/** Port HTTP interne, agnostique de `fetch`/`axios`/etc. Un 4xx/5xx est une reponse, pas une panne. */
export interface HttpClient {
  get(request: HttpRequest): Promise<Result<HttpResponse, HttpFailure>>
}
