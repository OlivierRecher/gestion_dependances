import type { Address } from '../../src/domain/address.ts'
import type { Coordinates, Forecast, Place } from '../../src/domain/model.ts'

export const anAddress = (raw = 'Ales'): Address => raw as Address

export const someCoordinates: Coordinates = { latitude: 44.1281, longitude: 4.0817 }

export const aPlace = (overrides: Partial<Place> = {}): Place => ({
  label: 'Ales, Gard, Occitanie, France',
  coordinates: someCoordinates,
  ...overrides,
})

export const aForecast = (overrides: Partial<Forecast> = {}): Forecast => ({
  coordinates: someCoordinates,
  timezone: 'GMT',
  samples: [
    { time: '2026-09-18T00:00', shortwaveRadiation: 0 },
    { time: '2026-09-18T12:00', shortwaveRadiation: 512.4 },
  ],
  ...overrides,
})
