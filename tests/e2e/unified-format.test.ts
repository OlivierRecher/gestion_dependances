import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { startTestServer } from '../support/test-server.ts'
import type { FakeUpstreams, Upstream } from '../support/fake-upstreams.ts'
import { respond } from '../support/fake-upstreams.ts'

const BAN_BODY = JSON.stringify({
  features: [{ properties: { label: 'Ales' }, geometry: { coordinates: [4.0817, 44.1279] } }],
})

const MET_NORWAY_BODY = JSON.stringify({
  geometry: { coordinates: [4.0817, 44.1279, 130] },
  properties: {
    timeseries: [{ time: '2025-06-10T14:00:00Z', data: { instant: { details: { air_temperature: 24.3 } } } }],
  },
})

/** BAN + MET Norway derriere un meme `fetch` factice, comme `fakeUpstreams` pour Nominatim + Open-Meteo. */
const banAndMetNorway = (): FakeUpstreams => {
  const geocoding: Upstream = { reply: respond(BAN_BODY), calls: 0 }
  const forecast: Upstream = { reply: respond(MET_NORWAY_BODY), calls: 0 }
  const serve = (upstream: Upstream): Promise<Response> => {
    upstream.calls += 1
    return upstream.reply.kind === 'respond'
      ? Promise.resolve(new Response(upstream.reply.body, { status: upstream.reply.status }))
      : Promise.reject(new TypeError('fetch failed'))
  }

  return {
    geocoding,
    forecast,
    fetch: (url) => {
      const { pathname } = new URL(url)
      if (pathname.startsWith('/search')) return serve(geocoding)
      if (pathname.startsWith('/weatherapi')) return serve(forecast)
      return Promise.reject(new TypeError(`amont non simule : ${url}`))
    },
  }
}

/** Forme d'une valeur JSON, sans son contenu : ce que le client de l'API voit comme contrat. */
const shapeOf = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.length === 0 ? [] : [shapeOf(value[0])]
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item)]))
  }
  return typeof value
}

const EXPECTED_SHAPE = {
  address: 'string',
  latitude: 'number',
  longitude: 'number',
  hourly: [{ time: 'string', temperatureCelsius: 'number' }],
}

describe('TP3 : format de sortie unifie', () => {
  it('Nominatim + Open-Meteo produisent le format commun', async () => {
    const server = await startTestServer()
    try {
      const response = await server.get('/forecast?address=Ales')

      assert.equal(response.status, 200)
      assert.deepEqual(shapeOf(response.body), EXPECTED_SHAPE)
    } finally {
      await server.close()
    }
  })

  it('BAN + MET Norway produisent exactement le meme format', async () => {
    const server = await startTestServer({
      env: { GEOCODING_PROVIDER: 'ban', FORECAST_PROVIDER: 'met-norway' },
      upstreams: banAndMetNorway(),
    })
    try {
      const response = await server.get('/forecast?address=Ales')

      assert.equal(response.status, 200)
      assert.deepEqual(response.body, {
        address: 'Ales',
        latitude: 44.1279,
        longitude: 4.0817,
        hourly: [{ time: '2025-06-10T14:00:00Z', temperatureCelsius: 24.3 }],
      })
    } finally {
      await server.close()
    }
  })

  it('les instants sont en UTC quel que soit le fournisseur', async () => {
    const server = await startTestServer()
    try {
      const body = (await server.get('/forecast?address=Ales')).body as { hourly: { time: string }[] }

      assert.ok(body.hourly.every((sample) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(sample.time)))
    } finally {
      await server.close()
    }
  })
})

describe('TP3 : mode demo', () => {
  it('renvoie des donnees simulees au format commun sans appeler aucun service externe', async () => {
    const server = await startTestServer()
    try {
      const response = await server.get('/forecast?address=Al%C3%A8s&demo=true')

      assert.equal(response.status, 200)
      assert.deepEqual(shapeOf(response.body), EXPECTED_SHAPE)
      assert.equal((response.body as { address: string }).address, 'Alès')
      assert.equal(server.upstreams.geocoding.calls, 0)
      assert.equal(server.upstreams.forecast.calls, 0)
    } finally {
      await server.close()
    }
  })

  it('fonctionne meme quand les services reels sont en panne', async () => {
    const server = await startTestServer()
    try {
      server.upstreams.geocoding.reply = { kind: 'network-error' }
      server.upstreams.forecast.reply = { kind: 'network-error' }

      assert.equal((await server.get('/forecast?address=Ales&demo=true')).status, 200)
    } finally {
      await server.close()
    }
  })

  it('n est actif que pour demo=true', async () => {
    const server = await startTestServer()
    try {
      await server.get('/forecast?address=Ales&demo=false')

      assert.equal(server.upstreams.geocoding.calls, 1)
    } finally {
      await server.close()
    }
  })
})

describe('TP3 : cache sur le geocodage', () => {
  it('deux appels sur la meme adresse ne declenchent qu un appel reseau de geocodage', async () => {
    const server = await startTestServer({ env: { GEOCODING_PROVIDER: 'ban', FORECAST_PROVIDER: 'met-norway' }, upstreams: banAndMetNorway() })
    try {
      await server.get('/forecast?address=Ales')
      await server.get('/forecast?address=Ales')

      assert.equal(server.upstreams.geocoding.calls, 1)
    } finally {
      await server.close()
    }
  })
})
