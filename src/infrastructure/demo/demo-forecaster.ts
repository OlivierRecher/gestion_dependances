import type { Coordinates, TemperatureSample } from '../../domain/model.ts'
import type { ClockPort, ForecastService } from '../../domain/ports.ts'
import { ok } from '../../domain/result.ts'

const HOUR_MS = 60 * 60 * 1000
const HOURS = 24

/** `toISOString` donne des millisecondes ; le format commun s'arrete a la seconde. */
const toUtcInstant = (epochMs: number): string => new Date(epochMs).toISOString().replace(/\.\d{3}Z$/u, 'Z')

/** Courbe journaliere plausible : minimum vers 4 h, maximum vers 16 h UTC. */
const simulatedTemperature = (epochMs: number): number => {
  const hour = new Date(epochMs).getUTCHours()
  return Math.round((18 + 6 * Math.sin(((hour - 10) / 24) * 2 * Math.PI)) * 10) / 10
}

/** Previsions simulees sur 24 h a partir de l'heure courante, sans appel externe. */
export const createDemoForecaster = (clock: ClockPort): ForecastService => ({
  forecastAt: (coordinates: Coordinates) => {
    const start = Math.floor(clock.now() / HOUR_MS) * HOUR_MS
    const samples: TemperatureSample[] = Array.from({ length: HOURS }, (_, index) => {
      const time = start + index * HOUR_MS
      return { time: toUtcInstant(time), temperatureCelsius: simulatedTemperature(time) }
    })

    return Promise.resolve(ok({ coordinates, timezone: 'GMT', samples }))
  },
})
