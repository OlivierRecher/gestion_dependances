import { problemResponse, type ApiHandler, type ApiRequest } from './api.ts'

export type Route = {
  readonly method: string
  readonly path: string
  readonly handler: ApiHandler
}

/** `/weather/` et `/weather` designent la meme ressource. */
const normalizePath = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path

/** Un HEAD doit repondre comme un GET, en-tetes compris. */
const normalizeMethod = (method: string): string =>
  method.toUpperCase() === 'HEAD' ? 'GET' : method.toUpperCase()

const notFound = (request: ApiRequest) =>
  problemResponse({
    type: 'urn:api-meteo:route-not-found',
    title: 'Ressource inconnue',
    status: 404,
    detail: `Aucune ressource a l adresse "${request.path}".`,
  })

const methodNotAllowed = (allowed: readonly string[]) =>
  problemResponse(
    {
      type: 'urn:api-meteo:method-not-allowed',
      title: 'Methode non autorisee',
      status: 405,
      detail: `Methodes autorisees : ${allowed.join(', ')}.`,
    },
    {},
    { Allow: allowed.join(', ') },
  )

/**
 * Routeur exact, sans parametres de chemin ni expressions regulieres.
 *
 * C'est tout ce dont cette API a besoin. Un framework de routage serait ici
 * une dependance qu'on ne controle pas, pour une trentaine de lignes qu'on
 * controle entierement.
 */
export const createRouter = (routes: readonly Route[]): ApiHandler => async (request) => {
  const path = normalizePath(request.path)
  const method = normalizeMethod(request.method)

  const matchingPath = routes.filter((route) => route.path === path)
  if (matchingPath.length === 0) return notFound(request)

  const route = matchingPath.find((candidate) => candidate.method === method)
  if (route === undefined) {
    return methodNotAllowed(matchingPath.map((candidate) => candidate.method))
  }

  return route.handler(request)
}
