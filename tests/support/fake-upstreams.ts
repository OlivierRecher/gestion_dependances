import type { FetchLike } from '../../src/infrastructure/http/fetch-http-client.ts'

export type Reply =
  | { readonly kind: 'respond'; readonly status: number; readonly body: string }
  | { readonly kind: 'network-error' }
  | { readonly kind: 'timeout' }

export const respond = (body: string, status = 200): Reply => ({ kind: 'respond', status, body })
export const networkError = (): Reply => ({ kind: 'network-error' })
export const timeout = (): Reply => ({ kind: 'timeout' })

export type Upstream = { reply: Reply; calls: number }

export type FakeUpstreams = {
  readonly fetch: FetchLike
  readonly geocoding: Upstream
  readonly forecast: Upstream
}

export const NOMINATIM_BODY = JSON.stringify([
  { place_id: 1, lat: '44.1281', lon: '4.0817', display_name: 'Ales, Gard, Occitanie, France' },
])

export const OPEN_METEO_BODY = JSON.stringify({
  latitude: 44.125,
  longitude: 4.0,
  timezone: 'GMT',
  hourly: {
    time: ['2026-09-18T00:00', '2026-09-18T12:00'],
    shortwave_radiation: [0, 512.4],
  },
})

/**
 * Remplace les deux services externes en injectant un `fetch` factice.
 *
 * Les tests de bout en bout traversent le vrai serveur, le vrai routeur et les
 * vrais adaptateurs -- mais aucun appel ne sort de la machine. C'est
 * exactement ce que permet l'injection de dependances : la suite reste rapide,
 * deterministe, et capable de simuler des pannes qu'on ne saurait pas
 * provoquer sur de vrais services.
 */
export const fakeUpstreams = (
  initial: { geocoding?: Reply; forecast?: Reply } = {},
): FakeUpstreams => {
  const geocoding: Upstream = { reply: initial.geocoding ?? respond(NOMINATIM_BODY), calls: 0 }
  const forecast: Upstream = { reply: initial.forecast ?? respond(OPEN_METEO_BODY), calls: 0 }

  const serve = (upstream: Upstream): Promise<Response> => {
    upstream.calls += 1
    const { reply } = upstream

    switch (reply.kind) {
      case 'respond':
        return Promise.resolve(new Response(reply.body, { status: reply.status }))
      case 'network-error':
        return Promise.reject(new TypeError('fetch failed'))
      case 'timeout':
        return Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))
    }
  }

  return {
    geocoding,
    forecast,
    fetch: (url) => {
      const { pathname } = new URL(url)
      if (pathname.startsWith('/search')) return serve(geocoding)
      if (pathname.startsWith('/v1/forecast')) return serve(forecast)
      return Promise.reject(new TypeError(`amont non simule : ${url}`))
    },
  }
}
