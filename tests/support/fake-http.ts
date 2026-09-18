import type { HttpClient, HttpFailure, HttpRequest, HttpResponse } from '../../src/infrastructure/http/http-client.ts'
import { err, ok, type Result } from '../../src/domain/result.ts'

export type FakeHttp = {
  readonly client: HttpClient
  readonly requests: HttpRequest[]
  readonly lastUrl: () => URL
}

export const fakeHttp = (answer: Result<HttpResponse, HttpFailure>): FakeHttp => {
  const requests: HttpRequest[] = []
  return {
    requests,
    lastUrl: () => new URL(requests[requests.length - 1]?.url ?? 'about:blank'),
    client: {
      get: (request) => {
        requests.push(request)
        return Promise.resolve(answer)
      },
    },
  }
}

export const httpOk = (body: string, status = 200) => ok({ status, body })
export const httpStatus = (status: number, body = '') => ok({ status, body })
export const httpTimeout = () => err<HttpFailure>({ kind: 'http-timeout' })
export const httpNetwork = (detail = 'fetch failed') => err<HttpFailure>({ kind: 'http-network', detail })
