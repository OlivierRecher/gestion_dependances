import { err, ok, type Result } from '../domain/result.ts'

export type GeocodingProvider = 'nominatim' | 'ban'
export type ForecastProvider = 'open-meteo' | 'met-norway'

export type Config = {
  readonly port: number
  readonly geocoding: {
    readonly provider: GeocodingProvider
    readonly baseUrl: string
    readonly userAgent: string
    readonly timeoutMs: number
  }
  readonly forecast: {
    readonly provider: ForecastProvider
    readonly baseUrl: string
    /** MET Norway l'exige ; Open-Meteo l'ignore sans en souffrir. */
    readonly userAgent: string
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
  GEOCODING_PROVIDER: 'nominatim',
  GEOCODING_BASE_URL: 'https://nominatim.openstreetmap.org',
  GEOCODING_USER_AGENT: 'api-meteo/1.0 (TP gestion des dependances)',
  GEOCODING_TIMEOUT_MS: '3000',
  FORECAST_PROVIDER: 'open-meteo',
  FORECAST_BASE_URL: 'https://api.open-meteo.com',
  FORECAST_USER_AGENT: 'api-meteo/1.0 (TP gestion des dependances)',
  FORECAST_TIMEOUT_MS: '3000',
  CACHE_TTL_MS: '300000',
  CACHE_STALE_TTL_MS: '3600000',
  CACHE_MAX_ENTRIES: '500',
  BREAKER_FAILURE_THRESHOLD: '3',
  BREAKER_RESET_TIMEOUT_MS: '15000',
} as const satisfies Record<string, string>

type Key = keyof typeof DEFAULTS

/** Un reglage vide ou blanc vaut absent : un `.env` a moitie rempli ne doit pas tout casser. */
const rawValueOr = (env: Environment, key: Key, fallback: string): string => {
  const value = env[key]?.trim()
  return value === undefined || value === '' ? fallback : value
}

const rawValue = (env: Environment, key: Key): string => rawValueOr(env, key, DEFAULTS[key])

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

  /** `fallback` : la base par defaut depend du fournisseur choisi, pas seulement de la cle. */
  const httpUrl = (env: Environment, key: Key, fallback: string = DEFAULTS[key]): string => {
    const raw = rawValueOr(env, key, fallback)

    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      issues.push(`${key}: url absolue attendue, recu "${raw}"`)
      return fallback
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      issues.push(`${key}: schema http ou https attendu, recu "${parsed.protocol}"`)
      return fallback
    }

    return raw
  }

  const oneOf = <T extends string>(env: Environment, key: Key, allowed: readonly T[]): T => {
    const raw = rawValue(env, key)
    if ((allowed as readonly string[]).includes(raw)) return raw as T

    issues.push(`${key}: attendu parmi ${allowed.join(', ')}, recu "${raw}"`)
    return DEFAULTS[key] as T
  }

  return { issues, integer, httpUrl, oneOf, text: rawValue }
}

const MAX_TIMEOUT_MS = 60_000
const MAX_DURATION_MS = 24 * 60 * 60 * 1000

const GEOCODING_BASE_URL_DEFAULTS: Readonly<Record<GeocodingProvider, string>> = {
  nominatim: DEFAULTS.GEOCODING_BASE_URL,
  ban: 'https://api-adresse.data.gouv.fr',
}

const FORECAST_BASE_URL_DEFAULTS: Readonly<Record<ForecastProvider, string>> = {
  'open-meteo': DEFAULTS.FORECAST_BASE_URL,
  'met-norway': 'https://api.met.no',
}

/** Lit la configuration depuis un environnement fourni, jamais depuis `process.env`. */
export const loadConfig = (env: Environment): Result<Config, ConfigError> => {
  const collect = createCollector()

  const geocodingProvider = collect.oneOf(env, 'GEOCODING_PROVIDER', ['nominatim', 'ban'] as const)
  const forecastProvider = collect.oneOf(env, 'FORECAST_PROVIDER', ['open-meteo', 'met-norway'] as const)

  const config: Config = {
    port: collect.integer(env, 'PORT', 1, 65_535),
    geocoding: {
      provider: geocodingProvider,
      baseUrl: collect.httpUrl(env, 'GEOCODING_BASE_URL', GEOCODING_BASE_URL_DEFAULTS[geocodingProvider]),
      userAgent: collect.text(env, 'GEOCODING_USER_AGENT'),
      timeoutMs: collect.integer(env, 'GEOCODING_TIMEOUT_MS', 1, MAX_TIMEOUT_MS),
    },
    forecast: {
      provider: forecastProvider,
      baseUrl: collect.httpUrl(env, 'FORECAST_BASE_URL', FORECAST_BASE_URL_DEFAULTS[forecastProvider]),
      userAgent: collect.text(env, 'FORECAST_USER_AGENT'),
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
