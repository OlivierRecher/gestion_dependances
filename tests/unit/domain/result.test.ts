import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { err, isErr, isOk, map, mapErr, ok } from '../../../src/domain/result.ts'

describe('Result', () => {
  it('porte une valeur en cas de succes', () => {
    const result = ok(42)

    assert.equal(result.ok, true)
    assert.equal(isOk(result), true)
    assert.equal(isErr(result), false)
    if (isOk(result)) assert.equal(result.value, 42)
  })

  it('porte une erreur en cas d echec', () => {
    const result = err('boom')

    assert.equal(result.ok, false)
    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(result.error, 'boom')
  })

  it('map transforme la valeur de succes', () => {
    assert.deepEqual(map(ok(2), (n: number) => n * 3), ok(6))
  })

  it('map laisse une erreur intacte', () => {
    assert.deepEqual(map(err('boom'), (n: number) => n * 3), err('boom'))
  })

  it('mapErr transforme l erreur', () => {
    assert.deepEqual(mapErr(err('boom'), (e: string) => e.toUpperCase()), err('BOOM'))
  })

  it('mapErr laisse un succes intact', () => {
    assert.deepEqual(mapErr(ok(2), (e: string) => e.toUpperCase()), ok(2))
  })
})
