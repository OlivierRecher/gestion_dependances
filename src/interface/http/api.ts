/** Contrat entre le transport et les endpoints : ces derniers restent de simples fonctions pures. */
export type ApiRequest = {
  readonly method: string
  readonly path: string
  readonly query: Readonly<Record<string, string>>
}

export type ApiResponse = {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  /** Valeur serialisable en JSON ; la serialisation est faite par le transport. */
  readonly body: unknown
}

export type ApiHandler = (request: ApiRequest) => Promise<ApiResponse>

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8'

/** Probleme au format RFC 9457, pour que les erreurs soient exploitables par un client. */
export type Problem = {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail: string
}

export const jsonResponse = (
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): ApiResponse => ({
  status,
  headers: { 'Content-Type': JSON_CONTENT_TYPE, ...headers },
  body,
})

export const problemResponse = (
  problem: Problem,
  extensions: Readonly<Record<string, unknown>> = {},
  headers: Readonly<Record<string, string>> = {},
): ApiResponse => ({
  status: problem.status,
  headers: { 'Content-Type': PROBLEM_CONTENT_TYPE, ...headers },
  body: { ...problem, ...extensions },
})
