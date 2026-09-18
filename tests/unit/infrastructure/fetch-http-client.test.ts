import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createFetchHttpClient, type FetchLike } from '../../../src/infrastructure/http/fetch-http-client.ts'
import { err, isOk, ok } from '../../../src/domain/result.ts'

const respondWith = (status: number, body: string): FetchLike =>
  () => Promise.resolve(new Response(body, { status }))

describe('fetchHttpClient', () => {
  it('renvoie le statut et le corps de la reponse', async () => {
    const client = createFetchHttpClient({ fetch: respondWith(200, '{"ok":true}') })

    const result = await client.get({ url: 'https://exemple.test/x', timeoutMs: 1_000 })

    assert.deepEqual(result, ok({ status: 200, body: '{"ok":true}' }))
  })

  it('traite un statut d erreur comme une reponse, pas comme une panne de transport', async () => {
    const client = createFetchHttpClient({ fetch: respondWith(503, 'indisponible') })

    const result = await client.get({ url: 'https://exemple.test/x', timeoutMs: 1_000 })

    assert.equal(isOk(result), true)
    if (isOk(result)) assert.equal(result.value.status, 503)
  })

  it('transmet l url et les en-tetes demandes', async () => {
    let seenUrl: string | undefined
    let seenInit: RequestInit | undefined
    const client = createFetchHttpClient({
      fetch: (url, init) => {
        seenUrl = String(url)
        seenInit = init
        return Promise.resolve(new Response('ok', { status: 200 }))
      },
    })

    await client.get({
      url: 'https://exemple.test/search?q=Ales',
      headers: { 'User-Agent': 'api-meteo/1.0' },
      timeoutMs: 1_000,
    })

    assert.equal(seenUrl, 'https://exemple.test/search?q=Ales')
    assert.deepEqual(seenInit?.headers, { 'User-Agent': 'api-meteo/1.0' })
  })

  it('arme un signal d annulation sur chaque appel sortant', async () => {
    let signal: AbortSignal | null | undefined
    const client = createFetchHttpClient({
      fetch: (_url, init) => {
        signal = init?.signal
        return Promise.resolve(new Response('ok', { status: 200 }))
      },
    })

    await client.get({ url: 'https://exemple.test/x', timeoutMs: 1_000 })

    assert.ok(signal instanceof AbortSignal, 'aucun appel sortant ne doit pouvoir pendre indefiniment')
  })

  it('traduit un depassement de delai en panne de timeout', async () => {
    const client = createFetchHttpClient({
      fetch: () => Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    })

    const result = await client.get({ url: 'https://exemple.test/x', timeoutMs: 1 })

    assert.deepEqual(result, err({ kind: 'http-timeout' }))
  })

  it('traduit une annulation en panne de timeout', async () => {
    const client = createFetchHttpClient({
      fetch: () => Promise.reject(new DOMException('This operation was aborted', 'AbortError')),
    })

    const result = await client.get({ url: 'https://exemple.test/x', timeoutMs: 1 })

    assert.deepEqual(result, err({ kind: 'http-timeout' }))
  })

  it('traduit une erreur reseau en panne reseau', async () => {
    const client = createFetchHttpClient({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    })

    const result = await client.get({ url: 'https://exemple.test/x', timeoutMs: 1_000 })

    assert.deepEqual(result, err({ kind: 'http-network', detail: 'fetch failed' }))
  })

  it('ne laisse echapper aucune exception, meme inattendue', async () => {
    const client = createFetchHttpClient({
      fetch: () => Promise.reject('panne non standard'),
    })

    const result = await client.get({ url: 'https://exemple.test/x', timeoutMs: 1_000 })

    assert.deepEqual(result, err({ kind: 'http-network', detail: 'panne non standard' }))
  })
})
