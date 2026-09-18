import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Survie du processus reel, verifiee en le lancant pour de bon.
 *
 * Ce scenario ne peut pas etre simule en memoire : `process.stdout.write` sur
 * un tuyau est asynchrone, et son echec remonte par un evenement 'error' que
 * jamais aucun try/catch n'interceptera. Il faut un vrai processus et un vrai
 * tuyau ferme pour le reproduire.
 */

const MAIN = resolve(import.meta.dirname, '../../src/main.ts')
// Port fixe : `PORT=0` serait refuse par la validation de configuration, qui
// exige un port reel entre 1 et 65535.
const PORT = '45871'
const HEALTH = `http://127.0.0.1:${PORT}/health`

const startApi = (): ChildProcess =>
  spawn(process.execPath, [MAIN], {
    env: { ...process.env, PORT },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const waitUntilServing = async (): Promise<boolean> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(HEALTH)).status === 200) return true
    } catch {
      // Pas encore en ecoute.
    }
    await delay(100)
  }
  return false
}

const isAlive = (child: ChildProcess): boolean =>
  child.exitCode === null && child.signalCode === null

describe('survie du processus', () => {
  it('continue de servir quand le tuyau de journalisation se ferme', async () => {
    const child = startApi()
    const stderr: string[] = []
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))

    try {
      assert.equal(await waitUntilServing(), true, 'l API n a jamais repondu')

      // Le lecteur des journaux disparait : toute ecriture suivante provoque
      // EPIPE, comme `node src/main.ts | head -1` ou un agent de collecte
      // qui redemarre.
      child.stdout?.destroy()
      await delay(500)

      assert.equal((await fetch(HEALTH)).status, 200, `l API a cesse de servir :\n${stderr.join('')}`)
      assert.equal(isAlive(child), true, `le processus est mort :\n${stderr.join('')}`)
    } finally {
      child.kill('SIGKILL')
    }
  })

  it('demarre meme si le tuyau de journalisation est deja ferme', async () => {
    const child = startApi()
    const stderr: string[] = []
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()))

    // Ferme avant la toute premiere ligne : le demarrage est le moment ou
    // l'on journalise le plus, et donc le plus expose.
    child.stdout?.destroy()

    try {
      assert.equal(
        await waitUntilServing(),
        true,
        `l API n a pas demarre alors que seule la journalisation a echoue :\n${stderr.join('')}`,
      )
      assert.equal(isAlive(child), true)
    } finally {
      child.kill('SIGKILL')
    }
  })
})
