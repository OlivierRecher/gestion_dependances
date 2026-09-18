import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createCircuitBreaker } from '../../../src/resilience/circuit-breaker.ts'
import { fakeClock } from '../../support/fake-clock.ts'

const build = (failureThreshold = 3, resetTimeoutMs = 10_000) => {
  const clock = fakeClock()
  const breaker = createCircuitBreaker({ clock, failureThreshold, resetTimeoutMs })
  return { clock, breaker }
}

describe('circuitBreaker', () => {
  it('est ferme et passant au demarrage', () => {
    const { breaker } = build()

    assert.equal(breaker.state(), 'closed')
    assert.equal(breaker.canAttempt(), true)
  })

  it('reste ferme tant que le seuil d echecs n est pas atteint', () => {
    const { breaker } = build(3)

    breaker.recordFailure()
    breaker.recordFailure()

    assert.equal(breaker.state(), 'closed')
    assert.equal(breaker.canAttempt(), true)
  })

  it('s ouvre au seuil d echecs consecutifs', () => {
    const { breaker } = build(3)

    breaker.recordFailure()
    breaker.recordFailure()
    breaker.recordFailure()

    assert.equal(breaker.state(), 'open')
    assert.equal(breaker.canAttempt(), false, 'un circuit ouvert protege le service en panne')
  })

  it('remet le compteur a zero apres un succes', () => {
    const { breaker } = build(3)

    breaker.recordFailure()
    breaker.recordFailure()
    breaker.recordSuccess()
    breaker.recordFailure()
    breaker.recordFailure()

    assert.equal(breaker.state(), 'closed')
  })

  it('passe en semi-ouvert apres le delai de reprise', () => {
    const { breaker, clock } = build(1, 10_000)

    breaker.recordFailure()
    assert.equal(breaker.state(), 'open')

    clock.advance(9_999)
    assert.equal(breaker.state(), 'open')
    assert.equal(breaker.canAttempt(), false)

    clock.advance(1)
    assert.equal(breaker.state(), 'half-open')
    assert.equal(breaker.canAttempt(), true, 'un appel sonde est autorise')
  })

  it('se referme si la sonde reussit', () => {
    const { breaker, clock } = build(1, 10_000)

    breaker.recordFailure()
    clock.advance(10_000)
    breaker.recordSuccess()

    assert.equal(breaker.state(), 'closed')
    assert.equal(breaker.canAttempt(), true)
  })

  it('se rouvre et repart pour un cycle complet si la sonde echoue', () => {
    const { breaker, clock } = build(1, 10_000)

    breaker.recordFailure()
    clock.advance(10_000)
    assert.equal(breaker.state(), 'half-open')

    breaker.recordFailure()
    assert.equal(breaker.state(), 'open')

    clock.advance(9_999)
    assert.equal(breaker.state(), 'open', 'le delai de reprise redemarre a zero')

    clock.advance(1)
    assert.equal(breaker.state(), 'half-open')
  })

  it('n autorise qu une seule sonde a la fois en semi-ouvert', () => {
    const { breaker, clock } = build(1, 10_000)

    breaker.recordFailure()
    clock.advance(10_000)

    assert.equal(breaker.canAttempt(), true)
    assert.equal(breaker.canAttempt(), false, 'la deuxieme requete ne doit pas sonder aussi')
  })
})
