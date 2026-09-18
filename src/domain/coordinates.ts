import { err, ok, type Result } from './result.ts'

export type Coordinates = {
  readonly latitude: number
  readonly longitude: number
}

export type InvalidCoordinates = {
  readonly kind: 'invalid-coordinates'
  readonly reason: 'not-finite' | 'latitude-out-of-range' | 'longitude-out-of-range'
}

export const createCoordinates = (
  latitude: number,
  longitude: number,
): Result<Coordinates, InvalidCoordinates> => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return err({ kind: 'invalid-coordinates', reason: 'not-finite' })
  }
  if (latitude < -90 || latitude > 90) {
    return err({ kind: 'invalid-coordinates', reason: 'latitude-out-of-range' })
  }
  if (longitude < -180 || longitude > 180) {
    return err({ kind: 'invalid-coordinates', reason: 'longitude-out-of-range' })
  }

  return ok({ latitude, longitude })
}
