import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createCoordinates } from '../../../src/domain/coordinates.ts'
import { isErr, isOk } from '../../../src/domain/result.ts'

describe('createCoordinates', () => {
  it('accepte des coordonnees valides', () => {
    const result = createCoordinates(44.1281, 4.0817)

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.deepEqual(result.value, { latitude: 44.1281, longitude: 4.0817 })
  })

  it('accepte les bornes', () => {
    assert.equal(isOk(createCoordinates(-90, -180)), true)
    assert.equal(isOk(createCoordinates(90, 180)), true)
  })

  it('refuse une latitude hors bornes', () => {
    const result = createCoordinates(91, 0)

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.deepEqual(result.error, { kind: 'invalid-coordinates', reason: 'latitude-out-of-range' })
  })

  it('refuse une longitude hors bornes', () => {
    const result = createCoordinates(0, -181)

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(result.error.reason, 'longitude-out-of-range')
  })

  it('refuse des valeurs non finies', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = createCoordinates(value, 0)
      assert.equal(isErr(result), true, `latitude ${value} devrait etre refusee`)
      if (isErr(result)) assert.equal(result.error.reason, 'not-finite')
    }

    const result = createCoordinates(0, Number.NaN)
    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(result.error.reason, 'not-finite')
  })
})
