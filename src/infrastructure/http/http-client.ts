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

/**
 * Port HTTP interne. Il ne connait ni `fetch`, ni `axios`, ni `undici`.
 *
 * Un statut 4xx/5xx n'est pas une panne a ce niveau : c'est une reponse. Seule
 * l'impossibilite d'obtenir une reponse est une panne. Interpreter le statut
 * est la responsabilite de l'adaptateur metier, qui seul connait le contrat du
 * fournisseur.
 */
export interface HttpClient {
  get(request: HttpRequest): Promise<Result<HttpResponse, HttpFailure>>
}
