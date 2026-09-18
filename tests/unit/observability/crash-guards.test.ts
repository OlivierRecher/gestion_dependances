import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { installCrashGuards, type CrashSignals } from '../../../src/observability/crash-guards.ts'
import type { Logger } from '../../../src/observability/logger.ts'

type Listener = (reason: unknown) => void

const fakeSignals = () => {
  const listeners = new Map<string, Listener>()
  const target: CrashSignals = { on: (event, listener) => void listeners.set(event, listener) }
  return {
    target,
    emit: (event: string, reason: unknown) => listeners.get(event)?.(reason),
    registered: () => [...listeners.keys()].sort(),
  }
}

const recordingLogger = () => {
  const events: string[] = []
  const logger: Logger = { log: (_level, event) => events.push(event) }
  return { logger, events }
}

describe('installCrashGuards', () => {
  it('installe un garde pour chaque mode de mort du processus', () => {
    const signals = fakeSignals()

    installCrashGuards(signals.target, recordingLogger().logger, () => {})

    assert.deepEqual(signals.registered(), ['uncaughtException', 'unhandledRejection'])
  })

  it('journalise une promesse rejetee sans arreter le processus', () => {
    const signals = fakeSignals()
    const { logger, events } = recordingLogger()
    let fatalCalls = 0

    installCrashGuards(signals.target, logger, () => {
      fatalCalls += 1
    })
    signals.emit('unhandledRejection', new Error('promesse oubliee'))

    assert.deepEqual(events, ['process.unhandled-rejection'])
    assert.equal(fatalCalls, 0, 'une promesse rejetee ne doit pas tuer un service qui sait encore repondre')
  })

  it('journalise une exception non rattrapee puis arrete proprement', () => {
    const signals = fakeSignals()
    const { logger, events } = recordingLogger()
    let fatalCalls = 0

    installCrashGuards(signals.target, logger, () => {
      fatalCalls += 1
    })
    signals.emit('uncaughtException', new Error('etat inconnu'))

    assert.deepEqual(events, ['process.uncaught-exception'])
    assert.equal(fatalCalls, 1, 'apres une exception non rattrapee, l etat n est plus fiable')
  })

  it('ne se laisse pas tuer par un logger defaillant', () => {
    const signals = fakeSignals()
    const throwing: Logger = {
      log: () => {
        throw new Error('EPIPE')
      },
    }
    let fatalCalls = 0

    installCrashGuards(signals.target, throwing, () => {
      fatalCalls += 1
    })

    assert.doesNotThrow(() => signals.emit('unhandledRejection', new Error('x')))
    assert.doesNotThrow(() => signals.emit('uncaughtException', new Error('y')))
    assert.equal(fatalCalls, 1, 'l arret propre doit avoir lieu malgre l echec de journalisation')
  })
})
