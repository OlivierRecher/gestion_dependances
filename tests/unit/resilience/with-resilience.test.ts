import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createCircuitBreaker } from '../../../src/resilience/circuit-breaker.ts'
import { createTimedCache } from '../../../src/resilience/timed-cache.ts'
import { withResilience } from '../../../src/resilience/with-resilience.ts'
import { err, ok, type Result } from '../../../src/domain/result.ts'
import { fakeClock } from '../../support/fake-clock.ts'

type Failure = { kind: 'outage' | 'not-found'; detail?: string }

const outage: Failure = { kind: 'outage' }
const notFound: Failure = { kind: 'not-found' }
const circuitOpen: Failure = { kind: 'outage', detail: 'circuit-open' }

/** Amont programmable : chaque appel consomme la reponse suivante. */
const scriptedUpstream = (...answers: Result<string, Failure>[]) => {
  const calls: string[] = []
  let index = 0
  const call = (arg: string) => {
    calls.push(arg)
    const answer = answers[Math.min(index, answers.length - 1)]
    index += 1
    return Promise.resolve(answer ?? err(outage))
  }
  return { call, calls }
}

const build = (
  upstream: (arg: string) => Promise<Result<string, Failure>>,
  { ttlMs = 1_000, staleTtlMs = 60_000, failureThreshold = 2, resetTimeoutMs = 10_000 } = {},
) => {
  const clock = fakeClock()
  const cache = createTimedCache<string>({ clock, ttlMs, staleTtlMs, maxEntries: 10 })
  const breaker = createCircuitBreaker({ clock, failureThreshold, resetTimeoutMs })
  const call = withResilience(upstream, {
    cache,
    breaker,
    keyOf: (arg: string) => arg,
    isOutage: (failure: Failure) => failure.kind === 'outage',
    circuitOpenError: () => circuitOpen,
  })
  return { call, clock, breaker }
}

describe('withResilience', () => {
  it('sert la reponse amont et la marque comme fraiche', async () => {
    const upstream = scriptedUpstream(ok('meteo'))
    const { call } = build(upstream.call)

    assert.deepEqual(await call('ales'), ok({ data: 'meteo', freshness: 'live' }))
  })

  it('sert le cache sans appeler l amont dans la fenetre de TTL', async () => {
    const upstream = scriptedUpstream(ok('v1'), ok('v2'))
    const { call, clock } = build(upstream.call, { ttlMs: 1_000 })

    await call('ales')
    clock.advance(999)

    assert.deepEqual(await call('ales'), ok({ data: 'v1', freshness: 'cached' }))
    assert.equal(upstream.calls.length, 1, 'un seul appel amont')
  })

  it('rappelle l amont une fois le TTL expire', async () => {
    const upstream = scriptedUpstream(ok('v1'), ok('v2'))
    const { call, clock } = build(upstream.call, { ttlMs: 1_000 })

    await call('ales')
    clock.advance(1_000)

    assert.deepEqual(await call('ales'), ok({ data: 'v2', freshness: 'live' }))
    assert.equal(upstream.calls.length, 2)
  })

  it('sert la donnee perimee quand l amont tombe', async () => {
    const upstream = scriptedUpstream(ok('v1'), err(outage))
    const { call, clock } = build(upstream.call, { ttlMs: 1_000 })

    await call('ales')
    clock.advance(1_000)

    assert.deepEqual(await call('ales'), ok({ data: 'v1', freshness: 'stale' }))
  })

  it('propage la panne quand l amont tombe sans rien en cache', async () => {
    const upstream = scriptedUpstream(err(outage))
    const { call } = build(upstream.call)

    assert.deepEqual(await call('ales'), err(outage))
  })

  it('ouvre le circuit apres le seuil et cesse d appeler l amont', async () => {
    const upstream = scriptedUpstream(err(outage))
    const { call, breaker } = build(upstream.call, { failureThreshold: 2 })

    await call('ales')
    await call('ales')
    assert.equal(breaker.state(), 'open')

    assert.deepEqual(await call('ales'), err(circuitOpen))
    assert.equal(upstream.calls.length, 2, 'le service en panne n est plus sollicite')
  })

  it('sert la donnee perimee sans appeler l amont quand le circuit est ouvert', async () => {
    const upstream = scriptedUpstream(ok('v1'), err(outage), err(outage))
    const { call, clock } = build(upstream.call, { ttlMs: 1_000, failureThreshold: 1 })

    await call('ales')
    clock.advance(1_000)
    await call('ales')

    const callsBefore = upstream.calls.length
    assert.deepEqual(await call('ales'), ok({ data: 'v1', freshness: 'stale' }))
    assert.equal(upstream.calls.length, callsBefore, 'le circuit ouvert coupe l appel')
  })

  it('ne compte pas une reponse metier negative comme une panne', async () => {
    const upstream = scriptedUpstream(err(notFound))
    const { call, breaker } = build(upstream.call, { failureThreshold: 2 })

    assert.deepEqual(await call('atlantide'), err(notFound))
    await call('atlantide')
    await call('atlantide')

    assert.equal(breaker.state(), 'closed', 'le service repond correctement : il est sain')
  })

  it('ne met pas en cache une reponse metier negative', async () => {
    const upstream = scriptedUpstream(err(notFound), ok('trouve'))
    const { call } = build(upstream.call)

    await call('atlantide')

    assert.deepEqual(await call('atlantide'), ok({ data: 'trouve', freshness: 'live' }))
  })

  it('referme le circuit quand la sonde de reprise reussit', async () => {
    const upstream = scriptedUpstream(err(outage), ok('revenu'))
    const { call, clock, breaker } = build(upstream.call, { failureThreshold: 1, resetTimeoutMs: 10_000 })

    await call('ales')
    assert.equal(breaker.state(), 'open')

    clock.advance(10_000)

    assert.deepEqual(await call('ales'), ok({ data: 'revenu', freshness: 'live' }))
    assert.equal(breaker.state(), 'closed')
  })

  it('isole les cles : une entree en cache n en masque pas une autre', async () => {
    const upstream = scriptedUpstream(ok('ales'), ok('nimes'))
    const { call } = build(upstream.call)

    assert.deepEqual(await call('ales'), ok({ data: 'ales', freshness: 'live' }))
    assert.deepEqual(await call('nimes'), ok({ data: 'nimes', freshness: 'live' }))
  })
})
