import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createAddress } from '../../../src/domain/address.ts'
import { isErr, isOk } from '../../../src/domain/result.ts'

describe('createAddress', () => {
  it('accepte une adresse simple', () => {
    const result = createAddress('Ales')

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.equal(result.value, 'Ales')
  })

  it('supprime les espaces de bordure', () => {
    const result = createAddress('   12 rue Victor Hugo, Ales  ')

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.equal(result.value, '12 rue Victor Hugo, Ales')
  })

  it('normalise les espaces internes', () => {
    const result = createAddress('12   rue\tVictor\nHugo')

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.equal(result.value, '12 rue Victor Hugo')
  })

  it('refuse une adresse vide', () => {
    const result = createAddress('')

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.deepEqual(result.error, { kind: 'invalid-address', reason: 'empty' })
  })

  it('refuse une adresse uniquement composee d espaces', () => {
    const result = createAddress('    ')

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.equal(result.error.reason, 'empty')
  })

  it('refuse une adresse trop longue', () => {
    const result = createAddress('a'.repeat(257))

    assert.equal(isErr(result), true)
    if (isErr(result)) assert.deepEqual(result.error, { kind: 'invalid-address', reason: 'too-long' })
  })

  it('accepte une adresse a la longueur maximale', () => {
    assert.equal(isOk(createAddress('a'.repeat(256))), true)
  })
})
