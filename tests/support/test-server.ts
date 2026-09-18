import { createApp } from '../../src/composition/container.ts'
import { loadConfig, type Environment } from '../../src/config/config.ts'
import { startHttpServer } from '../../src/interface/http/server.ts'
import { silentLogger } from '../../src/observability/logger.ts'
import { fakeClock, type FakeClock } from './fake-clock.ts'
import { fakeUpstreams, type FakeUpstreams } from './fake-upstreams.ts'

export type TestServer = {
  readonly get: (path: string) => Promise<{ status: number; headers: Headers; body: unknown }>
  readonly upstreams: FakeUpstreams
  readonly clock: FakeClock
  readonly close: () => Promise<void>
}

const TEST_ENV: Environment = {
  GEOCODING_BASE_URL: 'https://geocoding.local',
  FORECAST_BASE_URL: 'https://forecast.local',
  CACHE_TTL_MS: '60000',
  CACHE_STALE_TTL_MS: '600000',
  BREAKER_FAILURE_THRESHOLD: '2',
  BREAKER_RESET_TIMEOUT_MS: '300000',
}

export const startTestServer = async (
  options: { env?: Environment; upstreams?: FakeUpstreams } = {},
): Promise<TestServer> => {
  const config = loadConfig({ ...TEST_ENV, ...options.env })
  if (!config.ok) throw new Error(`configuration de test invalide : ${config.error.issues.join(', ')}`)

  const upstreams = options.upstreams ?? fakeUpstreams()
  const clock = fakeClock()

  const app = createApp({
    config: config.value,
    fetch: upstreams.fetch,
    clock,
    logger: silentLogger,
  })

  const server = await startHttpServer({ handler: app.handler, port: 0, logger: silentLogger })
  const origin = `http://127.0.0.1:${server.port}`

  return {
    upstreams,
    clock,
    close: () => server.close(),
    get: async (path) => {
      const response = await fetch(`${origin}${path}`)
      const text = await response.text()
      return {
        status: response.status,
        headers: response.headers,
        body: text === '' ? undefined : (JSON.parse(text) as unknown),
      }
    },
  }
}
