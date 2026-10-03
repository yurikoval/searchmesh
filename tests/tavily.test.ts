import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  tavilyAdapter,
  PROVIDER_ADAPTER_LIMITS,
  type NormalizedSearchRequest,
  type ProviderAdapterContext,
} from '../src/index.js'

const fixtureSource = readFileSync(new URL('./fixtures/tavily-search.json', import.meta.url), 'utf8')
const credential = 'credential-canary'
const query = 'query canary'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 3 }
function context(fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { credentials: { api_key: credential }, signal, fetch: fetchMock, ...overrides }
}
function jsonResponse(body = fixtureSource, init: ResponseInit = {}) {
  return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
}
async function failureWith(fetchMock: typeof fetch, signal = new AbortController().signal) {
  const outcome = await tavilyAdapter(request, context(fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('Tavily adapter', () => {
  it('sends the exact bounded request and normalizes valid results in upstream order', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const signal = new AbortController().signal
    const outcome = await tavilyAdapter(request, context(fetchMock, signal))

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.tavily.com/search')
    expect(init).toEqual({
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, signal, redirect: 'error',
      body: JSON.stringify({ api_key: credential, query, max_results: 3, search_depth: 'basic', include_answer: false, include_raw_content: false, include_images: false }),
    })
    expect(outcome).toEqual({ ok: true, providerId: 'tavily', results: [
      { providerId: 'tavily', providerRank: 1, title: 'First result', url: 'https://research.example.com/report', domain: 'research.example.com', snippet: 'A concise research result.', publishedAt: '2025-03-04T00:00:00.000Z', providerScore: 0.91 },
      { providerId: 'tavily', providerRank: 3, title: 'Third result', url: 'https://example.net/notes', domain: 'example.net', snippet: 'Order and upstream rank remain stable.', providerScore: 0.42 },
    ] })
  })

  it.each([
    [{ ...request, language: 'en' }, 'optional input'],
    [{ ...request, limit: 21 }, 'invalid limit'],
    [{ ...request, query: `${query} ` }, 'untrimmed query'],
  ])('rejects %s before fetch', async (badRequest) => {
    const fetchMock = vi.fn<typeof fetch>()
    const outcome = await tavilyAdapter(badRequest, context(fetchMock))
    expect(outcome).toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects credential mismatches before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const contexts: ProviderAdapterContext[] = [
      context(fetchMock, undefined, { credentials: { api_key: `${credential}\n` } }),
    ]
    for (const candidate of contexts) {
      await expect(tavilyAdapter(request, candidate)).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns empty results and skips malformed entries without re-ranking', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('{"results":[]}'))
      .mockResolvedValueOnce(jsonResponse(fixtureSource))
    await expect(tavilyAdapter({ query, limit: 1 }, context(fetchMock))).resolves.toEqual({ ok: true, providerId: 'tavily', results: [] })
    const partial = await tavilyAdapter(request, context(fetchMock))
    expect(partial.ok && partial.results.map(({ providerRank }) => providerRank)).toEqual([1, 3])
  })

  it.each([
    [403, 'provider_authentication_failed'],
    [422, 'provider_rejected_request'],
    [429, 'provider_rate_limited'],
    [500, 'provider_unavailable'],
  ])('maps HTTP %i without exposing upstream content', async (status, code) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(upstreamError, { status, headers: { 'Retry-After': '4' } }))
    const outcome = await failureWith(fetchMock)
    expect(outcome).toMatchObject({ failure: { code, httpStatus: status } })
    if (status === 429) expect(outcome).toMatchObject({ failure: { retryAfterMs: 4_000 } })
    expect(JSON.stringify(outcome)).not.toContain(upstreamError)
  })

  it('maps network and aborted fetch failures without leaking canaries', async () => {
    const networkFetch = vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError))
    const network = await failureWith(networkFetch)
    const controller = new AbortController()
    controller.abort(upstreamError)
    const aborted = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)), controller.signal)
    expect(network).toMatchObject({ failure: { code: 'provider_unavailable' } })
    expect(aborted).toMatchObject({ failure: { code: 'provider_timeout' } })
    for (const canary of [credential, query, upstreamError]) expect(JSON.stringify([network, aborted])).not.toContain(canary)
  })

  it.each([
    [jsonResponse('{'), 'malformed JSON'],
    [jsonResponse(upstreamError.repeat(PROVIDER_ADAPTER_LIMITS.responseBytes), { headers: { 'Content-Length': String(PROVIDER_ADAPTER_LIMITS.responseBytes + 1) } }), 'oversized JSON'],
    [jsonResponse('{"unexpected":[]}'), 'invalid shape'],
  ])('rejects %s as an invalid response without leaking canaries', async (response) => {
    const outcome = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(response))
    expect(outcome).toMatchObject({ failure: { code: 'provider_invalid_response' } })
    for (const canary of [credential, query, upstreamError]) expect(JSON.stringify(outcome)).not.toContain(canary)
  })
})
