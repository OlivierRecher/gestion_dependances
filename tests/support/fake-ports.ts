import type { Coordinates, Sourced, Forecast, Freshness, Place } from '../../src/domain/model.ts'
import type { ForecastPort, GeocodingPort } from '../../src/domain/ports.ts'
import type { DependencyFailure, PlaceNotFound } from '../../src/domain/failures.ts'
import type { Address } from '../../src/domain/address.ts'
import { err, ok, type Result } from '../../src/domain/result.ts'

export const sourced = <T>(data: T, freshness: Freshness = 'live'): Sourced<T> => ({ data, freshness })

export type FakeGeocoding = GeocodingPort & { readonly calls: Address[] }

export const fakeGeocoding = (
  answer: Result<Sourced<Place>, DependencyFailure | PlaceNotFound>,
): FakeGeocoding => {
  const calls: Address[] = []
  return {
    calls,
    locate: (address) => {
      calls.push(address)
      return Promise.resolve(answer)
    },
  }
}

export type FakeForecast = ForecastPort & { readonly calls: Coordinates[] }

export const fakeForecast = (
  answer: Result<Sourced<Forecast>, DependencyFailure>,
): FakeForecast => {
  const calls: Coordinates[] = []
  return {
    calls,
    forecastAt: (coordinates) => {
      calls.push(coordinates)
      return Promise.resolve(answer)
    },
  }
}

export const unreachable = (dependency: DependencyFailure['dependency']): DependencyFailure => ({
  kind: 'dependency-failure',
  dependency,
  reason: 'unreachable',
})

export const okFetched = <T>(data: T, freshness: Freshness = 'live') => ok(sourced(data, freshness))
export const failed = <E>(failure: E) => err(failure)
