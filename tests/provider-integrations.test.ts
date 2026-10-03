import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  exaAdapter,
  kagiAdapter,
  PROVIDER_ADAPTER_LIMITS,
  yepAdapter,
  type ExecutableProviderId,
  type NormalizedSearchRequest,
  type ProviderAdapter,
  type ProviderAdapterContext,
} from '../src/index.js'

const credential = 'credential-canary'
const query = 'query-canary'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 2 }
const adapters: ReadonlyArray<{ id: ExecutableProviderId; adapter: ProviderAdapter }> = [
  { id: 'yep', adapter: yepAdapter },
  { id: 'exa', adapter: exaAdapter },
  { id: 'kagi', adapter: kagiAdapter },
]

function fixture(id: ExecutableProviderId): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${id}-search.json`, import.meta.url), 'utf8'))
}

function context(_id: ExecutableProviderId, fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { credentials: { api_key: credential }, signal, fetch: fetchMock, ...overrides }
}

function jsonResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
}

async function run(adapter: ProviderAdapter, id: ExecutableProviderId) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture(id)))
  const outcome = await adapter(request, context(id, fetchMock))
  expect(fetchMock).toHaveBeenCalledOnce()
  return { outcome, call: fetchMock.mock.calls[0] }
}

async function failureWith(adapter: ProviderAdapter, id: ExecutableProviderId, fetchMock: typeof fetch, signal = new AbortController().signal) {
  const outcome = await adapter(request, context(id, fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('additional provider adapters', () => {
  it('sends and normalizes a Yep search', async () => {
    const { outcome, call: [url, init] } = await run(yepAdapter, 'yep')
    expect(url.toString()).toBe('https://platform.yep.com/api/search')
    expect(init).toMatchObject({ method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, type: 'basic', limit: 2 }), redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'yep', results: [{ providerId: 'yep', providerRank: 1, title: 'Yep result', url: 'https://yep.example/page', domain: 'yep.example', snippet: 'Result text', publishedAt: '2026-01-02T00:00:00.000Z' }] })
  })

  it('sends and normalizes an Exa search', async () => {
    const { outcome, call: [url, init] } = await run(exaAdapter, 'exa')
    expect(url.toString()).toBe('https://api.exa.ai/search')
    expect(init).toMatchObject({ method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': credential }, body: JSON.stringify({ query, numResults: 2, type: 'auto', contents: { text: { maxCharacters: 4000 } } }), redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'exa', results: [{ providerId: 'exa', providerRank: 1, title: 'Exa result', url: 'https://exa.example/page', domain: 'exa.example', snippet: 'Extracted text', publishedAt: '2026-01-02T03:04:05.000Z', author: 'Author' }] })
  })

  it('sends and normalizes a Kagi v1 search once', async () => {
    const { outcome, call: [url, init] } = await run(kagiAdapter, 'kagi')
    expect(url.toString()).toBe('https://kagi.com/api/v1/search')
    expect(init).toMatchObject({ method: 'POST', headers: { Accept: 'application/json', Authorization: `Bot ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, workflow: 'search', limit: 2 }), redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'kagi', results: [{ providerId: 'kagi', providerRank: 1, title: 'Kagi result', url: 'https://kagi.example/page', domain: 'kagi.example', snippet: 'Result text', publishedAt: '2026-01-02T00:00:00.000Z' }] })
  })

  for (const { id, adapter } of adapters) {
    describe(id, () => {
      it.each([
        [{ ...request, language: 'en' }, 'optional input'],
        [{ ...request, limit: PROVIDER_ADAPTER_LIMITS.results + 1 }, 'invalid limit'],
        [{ ...request, query: `${query} ` }, 'untrimmed query'],
      ])('rejects %s before fetch', async (badRequest) => {
        const fetchMock = vi.fn<typeof fetch>()
        await expect(adapter(badRequest as NormalizedSearchRequest, context(id, fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it('rejects credential mismatches before fetch', async () => {
        const fetchMock = vi.fn<typeof fetch>()
        const valid = context(id, fetchMock)
        const contexts: ProviderAdapterContext[] = [
          { ...valid, credentials: { api_key: `${credential}\n` } },
        ]
        for (const candidate of contexts) await expect(adapter(request, candidate)).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
        expect(fetchMock).not.toHaveBeenCalled()
      })

      it.each([
        [401, 'provider_authentication_failed'],
        [403, 'provider_authentication_failed'],
        [422, 'provider_rejected_request'],
        [429, 'provider_rate_limited'],
        [500, 'provider_unavailable'],
      ])('maps HTTP %i without exposing upstream content', async (status, code) => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(upstreamError, { status, headers: { 'Retry-After': '4' } }))
        const outcome = await failureWith(adapter, id, fetchMock)
        expect(outcome).toMatchObject({ failure: { code, httpStatus: status } })
        if (status === 429) expect(outcome).toMatchObject({ failure: { retryAfterMs: 4_000 } })
        expect(JSON.stringify(outcome)).not.toContain(upstreamError)
      })

      it('maps network and aborted fetch failures without leaking canaries', async () => {
        const network = await failureWith(adapter, id, vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)))
        const controller = new AbortController()
        controller.abort(upstreamError)
        const aborted = await failureWith(adapter, id, vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)), controller.signal)
        expect(network).toMatchObject({ failure: { code: 'provider_unavailable' } })
        expect(aborted).toMatchObject({ failure: { code: 'provider_timeout' } })
        for (const canary of [credential, query, upstreamError]) expect(JSON.stringify([network, aborted])).not.toContain(canary)
      })

      it.each([
        [jsonResponse('{'), 'malformed JSON'],
        [new Response(upstreamError, { headers: { 'Content-Type': 'text/plain' } }), 'non-JSON response'],
        [jsonResponse(upstreamError.repeat(PROVIDER_ADAPTER_LIMITS.responseBytes), { headers: { 'Content-Length': String(PROVIDER_ADAPTER_LIMITS.responseBytes + 1) } }), 'oversized JSON'],
        [jsonResponse('{"unexpected":[]}'), 'invalid shape'],
      ])('rejects %s as an invalid response without leaking canaries', async (response) => {
        const outcome = await failureWith(adapter, id, vi.fn<typeof fetch>().mockResolvedValue(response))
        expect(outcome).toMatchObject({ failure: { code: 'provider_invalid_response' } })
        for (const canary of [credential, query, upstreamError]) expect(JSON.stringify(outcome)).not.toContain(canary)
      })

      it('cancels non-success response bodies without reading them', async () => {
        let cancelled = false
        const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
        await failureWith(adapter, id, vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429 })))
        expect(cancelled).toBe(true)
      })
    })
  }
})
