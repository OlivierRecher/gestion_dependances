import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { loadConfig } from '../../../src/config/config.ts'
import { isErr, isOk } from '../../../src/domain/result.ts'

const issuesOf = (env: Record<string, string | undefined>): readonly string[] => {
  const result = loadConfig(env)
  return isErr(result) ? result.error.issues : []
}

describe('loadConfig', () => {
  it('demarre avec des valeurs par defaut sur un environnement vide', () => {
    const result = loadConfig({})

    assert.equal(isOk(result), true)
    if (!isOk(result)) return
    assert.equal(result.value.port, 3000)
    assert.equal(result.value.geocoding.baseUrl, 'https://nominatim.openstreetmap.org')
    assert.equal(result.value.forecast.baseUrl, 'https://api.open-meteo.com')
  })

  it('ne lit pas l environnement du processus mais celui qu on lui passe', () => {
    const result = loadConfig({ PORT: '8080' })

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.equal(result.value.port, 8080)
  })

  it('surcharge chaque reglage depuis l environnement', () => {
    const result = loadConfig({
      PORT: '4000',
      GEOCODING_BASE_URL: 'https://geo.interne.test',
      GEOCODING_TIMEOUT_MS: '1500',
      GEOCODING_USER_AGENT: 'mon-agent/2.0',
      FORECAST_BASE_URL: 'https://meteo.interne.test',
      FORECAST_TIMEOUT_MS: '2500',
      CACHE_TTL_MS: '1000',
      CACHE_STALE_TTL_MS: '2000',
      CACHE_MAX_ENTRIES: '42',
      BREAKER_FAILURE_THRESHOLD: '5',
      BREAKER_RESET_TIMEOUT_MS: '30000',
    })

    assert.equal(isOk(result), true)
    if (!isOk(result)) return
    assert.deepEqual(result.value, {
      port: 4000,
      geocoding: {
        baseUrl: 'https://geo.interne.test',
        userAgent: 'mon-agent/2.0',
        timeoutMs: 1500,
      },
      forecast: {
        baseUrl: 'https://meteo.interne.test',
        timeoutMs: 2500,
      },
      cache: { ttlMs: 1000, staleTtlMs: 2000, maxEntries: 42 },
      breaker: { failureThreshold: 5, resetTimeoutMs: 30000 },
    })
  })

  it('refuse un port qui n est pas un entier', () => {
    assert.deepEqual(issuesOf({ PORT: 'abc' }), ['PORT: entier attendu, recu "abc"'])
  })

  it('refuse un port hors bornes', () => {
    assert.equal(issuesOf({ PORT: '0' }).length, 1)
    assert.equal(issuesOf({ PORT: '70000' }).length, 1)
  })

  it('refuse une url de service malformee', () => {
    const issues = issuesOf({ GEOCODING_BASE_URL: 'pas-une-url' })

    assert.equal(issues.length, 1)
    assert.match(issues[0] ?? '', /^GEOCODING_BASE_URL/)
  })

  it('refuse une url de service sans schema http', () => {
    assert.equal(issuesOf({ FORECAST_BASE_URL: 'ftp://meteo.test' }).length, 1)
  })

  it('refuse un delai nul ou negatif', () => {
    assert.equal(issuesOf({ GEOCODING_TIMEOUT_MS: '0' }).length, 1)
    assert.equal(issuesOf({ FORECAST_TIMEOUT_MS: '-1' }).length, 1)
  })

  it('refuse une fenetre de perime plus courte que le TTL', () => {
    const issues = issuesOf({ CACHE_TTL_MS: '5000', CACHE_STALE_TTL_MS: '1000' })

    assert.equal(issues.length, 1)
    assert.match(issues[0] ?? '', /CACHE_STALE_TTL_MS/)
  })

  it('accepte une fenetre de perime egale au TTL', () => {
    assert.equal(isOk(loadConfig({ CACHE_TTL_MS: '5000', CACHE_STALE_TTL_MS: '5000' })), true)
  })

  it('signale tous les problemes d un coup plutot qu un par redemarrage', () => {
    const issues = issuesOf({
      PORT: 'abc',
      GEOCODING_BASE_URL: 'pas-une-url',
      FORECAST_TIMEOUT_MS: '-1',
      BREAKER_FAILURE_THRESHOLD: '0',
    })

    assert.equal(issues.length, 4)
  })

  it('traite une variable vide comme absente', () => {
    const result = loadConfig({ PORT: '', GEOCODING_BASE_URL: '   ' })

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.equal(result.value.port, 3000)
  })
})
