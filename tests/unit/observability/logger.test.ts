import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createJsonLogger, neverThrows, type Logger } from '../../../src/observability/logger.ts'

const throwingLogger = (): Logger => ({
  log: () => {
    throw new Error('EPIPE: le puits de logs est tombe')
  },
})

describe('createJsonLogger', () => {
  it('ecrit une ligne JSON structuree', () => {
    const lines: string[] = []
    const logger = createJsonLogger((line) => lines.push(line), () => new Date('2026-09-18T10:00:00.000Z'))

    logger.log('info', 'server.started', { port: 3000 })

    assert.deepEqual(JSON.parse(lines[0] ?? ''), {
      timestamp: '2026-09-18T10:00:00.000Z',
      level: 'info',
      event: 'server.started',
      port: 3000,
    })
  })

  it('accepte un evenement sans donnees', () => {
    const lines: string[] = []
    const logger = createJsonLogger((line) => lines.push(line), () => new Date(0))

    logger.log('warn', 'quelque.chose')

    assert.equal((JSON.parse(lines[0] ?? '') as { event: string }).event, 'quelque.chose')
  })
})

describe('neverThrows', () => {
  it('delegue au logger sous-jacent', () => {
    const calls: string[] = []
    const logger = neverThrows({ log: (_level, event) => calls.push(event) })

    logger.log('info', 'test.evenement', { a: 1 })

    assert.deepEqual(calls, ['test.evenement'])
  })

  it('avale une exception du logger sous-jacent', () => {
    const logger = neverThrows(throwingLogger())

    assert.doesNotThrow(() => logger.log('error', 'peu.importe'))
  })

  it('reste utilisable apres une exception', () => {
    let shouldThrow = true
    const seen: string[] = []
    const logger = neverThrows({
      log: (_level, event) => {
        if (shouldThrow) throw new Error('panne passagere')
        seen.push(event)
      },
    })

    logger.log('error', 'pendant.la.panne')
    shouldThrow = false
    logger.log('info', 'apres.la.panne')

    assert.deepEqual(seen, ['apres.la.panne'], 'le logger ne doit pas se desactiver definitivement')
  })

  it('avale aussi une exception qui n est pas une Error', () => {
    const logger = neverThrows({
      log: () => {
        throw 'panne non standard'
      },
    })

    assert.doesNotThrow(() => logger.log('error', 'peu.importe'))
  })
})
