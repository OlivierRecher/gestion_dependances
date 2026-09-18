import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createHealthEndpoint } from '../../../src/interface/http/health-endpoint.ts'
import type { ApiRequest } from '../../../src/interface/http/api.ts'

const request: ApiRequest = { method: 'GET', path: '/health', query: {} }

describe('healthEndpoint', () => {
  it('rend ok quand tous les circuits sont fermes', async () => {
    const handler = createHealthEndpoint(() => [
      { name: 'nominatim', dependency: 'geocoding', circuit: 'closed' },
      { name: 'open-meteo', dependency: 'forecast', circuit: 'closed' },
    ])

    const response = await handler(request)

    assert.equal(response.status, 200)
    assert.deepEqual(response.body, {
      status: 'ok',
      dependencies: [
        { name: 'nominatim', dependency: 'geocoding', circuit: 'closed', healthy: true },
        { name: 'open-meteo', dependency: 'forecast', circuit: 'closed', healthy: true },
      ],
    })
  })

  it('rend degraded quand un circuit est ouvert, sans faire echouer la sonde', async () => {
    const handler = createHealthEndpoint(() => [
      { name: 'nominatim', dependency: 'geocoding', circuit: 'closed' },
      { name: 'open-meteo', dependency: 'forecast', circuit: 'open' },
    ])

    const response = await handler(request)

    assert.equal(response.status, 200, 'l API est vivante : elle sait encore servir du cache')
    assert.equal((response.body as { status: string }).status, 'degraded')
  })

  it('considere un circuit semi-ouvert comme degrade', async () => {
    const handler = createHealthEndpoint(() => [
      { name: 'open-meteo', dependency: 'forecast', circuit: 'half-open' },
    ])

    assert.equal(((await handler(request)).body as { status: string }).status, 'degraded')
  })

  it('interdit la mise en cache de la sonde', async () => {
    const handler = createHealthEndpoint(() => [])

    assert.equal((await handler(request)).headers['Cache-Control'], 'no-store')
  })
})
