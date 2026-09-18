import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createTimedCache } from '../../../src/resilience/timed-cache.ts'
import { fakeClock } from '../../support/fake-clock.ts'

const build = (ttlMs = 1_000, staleTtlMs = 10_000, maxEntries = 100) => {
  const clock = fakeClock()
  const cache = createTimedCache<string>({ clock, ttlMs, staleTtlMs, maxEntries })
  return { clock, cache }
}

describe('timedCache', () => {
  it('ne renvoie rien pour une cle inconnue', () => {
    const { cache } = build()

    assert.equal(cache.read('absente'), undefined)
  })

  it('renvoie une entree fraiche dans la fenetre de TTL', () => {
    const { cache, clock } = build(1_000)

    cache.write('ales', 'valeur')
    clock.advance(999)

    assert.deepEqual(cache.read('ales'), { value: 'valeur', freshness: 'cached' })
  })

  it('marque l entree comme perimee passe le TTL', () => {
    const { cache, clock } = build(1_000, 10_000)

    cache.write('ales', 'valeur')
    clock.advance(1_000)

    assert.deepEqual(cache.read('ales'), { value: 'valeur', freshness: 'stale' })
  })

  it('oublie l entree passe la fenetre de perime', () => {
    const { cache, clock } = build(1_000, 10_000)

    cache.write('ales', 'valeur')
    clock.advance(10_000)

    assert.equal(cache.read('ales'), undefined)
    assert.equal(cache.size(), 0, 'l entree expiree est purgee a la lecture')
  })

  it('rafraichit la date de stockage a chaque ecriture', () => {
    const { cache, clock } = build(1_000)

    cache.write('ales', 'v1')
    clock.advance(900)
    cache.write('ales', 'v2')
    clock.advance(900)

    assert.deepEqual(cache.read('ales'), { value: 'v2', freshness: 'cached' })
  })

  it('isole les cles les unes des autres', () => {
    const { cache } = build()

    cache.write('ales', 'gard')
    cache.write('nimes', 'gard aussi')

    assert.deepEqual(cache.read('ales'), { value: 'gard', freshness: 'cached' })
    assert.deepEqual(cache.read('nimes'), { value: 'gard aussi', freshness: 'cached' })
  })

  it('borne sa taille en evincant l entree la moins recemment utilisee', () => {
    const { cache } = build(1_000, 10_000, 2)

    cache.write('a', '1')
    cache.write('b', '2')
    cache.read('a')
    cache.write('c', '3')

    assert.equal(cache.size(), 2)
    assert.notEqual(cache.read('a'), undefined, 'a vient d etre lue, elle survit')
    assert.notEqual(cache.read('c'), undefined)
    assert.equal(cache.read('b'), undefined, 'b est la moins recemment utilisee')
  })
})
