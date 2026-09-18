import { err, ok, type Result } from '../domain/result.ts'

export type Config = {
  readonly port: number
  readonly geocoding: {
    readonly baseUrl: string
    readonly userAgent: string
    readonly timeoutMs: number
  }
  readonly forecast: {
    readonly baseUrl: string
    readonly timeoutMs: number
  }
  readonly cache: {
    readonly ttlMs: number
    readonly staleTtlMs: number
    readonly maxEntries: number
  }
  readonly breaker: {
    readonly failureThreshold: number
    readonly resetTimeoutMs: number
  }
}

export type ConfigError = {
  readonly kind: 'invalid-config'
  readonly issues: readonly string[]
}

export type Environment = Readonly<Record<string, string | undefined>>

const DEFAULTS = {
  PORT: '3000',
  GEOCODING_BASE_URL: 'https://nominatim.openstreetmap.org',
  GEOCODING_USER_AGENT: 'api-meteo/1.0 (TP gestion des dependances)',
  GEOCODING_TIMEOUT_MS: '3000',
  FORECAST_BASE_URL: 'https://api.open-meteo.com',
  FORECAST_TIMEOUT_MS: '3000',
  CACHE_TTL_MS: '300000',
  CACHE_STALE_TTL_MS: '3600000',
  CACHE_MAX_ENTRIES: '500',
  BREAKER_FAILURE_THRESHOLD: '3',
  BREAKER_RESET_TIMEOUT_MS: '15000',
} as const satisfies Record<string, string>

type Key = keyof typeof DEFAULTS

/** Un reglage vide ou blanc vaut absent : un `.env` a moitie rempli ne doit pas tout casser. */
const rawValue = (env: Environment, key: Key): string => {
  const value = env[key]?.trim()
  return value === undefined || value === '' ? DEFAULTS[key] : value
}

/** Collecte toutes les erreurs au lieu de s'arreter a la premiere. */
const createCollector = () => {
  const issues: string[] = []

  const integer = (env: Environment, key: Key, min: number, max: number): number => {
    const raw = rawValue(env, key)
    const parsed = Number(raw)

    if (!Number.isInteger(parsed)) {
      issues.push(`${key}: entier attendu, recu "${raw}"`)
      return Number(DEFAULTS[key])
    }
    if (parsed < min || parsed > max) {
      issues.push(`${key}: attendu entre ${min} et ${max}, recu ${parsed}`)
      return Number(DEFAULTS[key])
    }

    return parsed
  }

  const httpUrl = (env: Environment, key: Key): string => {
    const raw = rawValue(env, key)

    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      issues.push(`${key}: url absolue attendue, recu "${raw}"`)
      return DEFAULTS[key]
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      issues.push(`${key}: schema http ou https attendu, recu "${parsed.protocol}"`)
      return DEFAULTS[key]
    }

    return raw
  }

  return { issues, integer, httpUrl, text: rawValue }
}

const MAX_TIMEOUT_MS = 60_000
const MAX_DURATION_MS = 24 * 60 * 60 * 1000

/** Lit la configuration depuis un environnement fourni, jamais depuis `process.env`. */
export const loadConfig = (env: Environment): Result<Config, ConfigError> => {
  const collect = createCollector()

  const config: Config = {
    port: collect.integer(env, 'PORT', 1, 65_535),
    geocoding: {
      baseUrl: collect.httpUrl(env, 'GEOCODING_BASE_URL'),
      userAgent: collect.text(env, 'GEOCODING_USER_AGENT'),
      timeoutMs: collect.integer(env, 'GEOCODING_TIMEOUT_MS', 1, MAX_TIMEOUT_MS),
    },
    forecast: {
      baseUrl: collect.httpUrl(env, 'FORECAST_BASE_URL'),
      timeoutMs: collect.integer(env, 'FORECAST_TIMEOUT_MS', 1, MAX_TIMEOUT_MS),
    },
    cache: {
      ttlMs: collect.integer(env, 'CACHE_TTL_MS', 0, MAX_DURATION_MS),
      staleTtlMs: collect.integer(env, 'CACHE_STALE_TTL_MS', 0, MAX_DURATION_MS),
      maxEntries: collect.integer(env, 'CACHE_MAX_ENTRIES', 1, 1_000_000),
    },
    breaker: {
      failureThreshold: collect.integer(env, 'BREAKER_FAILURE_THRESHOLD', 1, 1_000),
      resetTimeoutMs: collect.integer(env, 'BREAKER_RESET_TIMEOUT_MS', 0, MAX_DURATION_MS),
    },
  }

  if (config.cache.staleTtlMs < config.cache.ttlMs) {
    collect.issues.push('CACHE_STALE_TTL_MS: doit etre superieur ou egal a CACHE_TTL_MS')
  }

  return collect.issues.length === 0
    ? ok(config)
    : err({ kind: 'invalid-config', issues: collect.issues })
}
