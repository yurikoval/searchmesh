import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/types.js'

vi.mock('../src/url-policy.js', () => ({
  getAdapterPolicy: (id: string) => id === 'serpapi' ? { origin: 'https://serpapi.com', basePath: '/', path: '/search', method: 'GET' } : undefined,
}))

const { serpApiAdapter } = await import('../src/adapters/serpapi.js')
const fixtureSource = readFileSync(new URL('./fixtures/serpapi-search.json', import.meta.url), 'utf8')
const credential = 'credential canary/+?&'
const query = 'query canary'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 3, language: 'en', region: 'US', timeRange: 'week' }
function context(fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { credentials: { api_key: credential }, signal, fetch: fetchMock, ...overrides }
}
function jsonResponse(body = fixtureSource, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }) }
async function failureWith(fetchMock: typeof fetch, candidate = request, signal = new AbortController().signal) {
  const outcome = await serpApiAdapter(candidate, context(fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('SerpApi adapter', () => {
  it('builds the exact credential-bearing runtime URL and normalizes documented ranks', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const signal = new AbortController().signal
    const outcome = await serpApiAdapter(request, context(fetchMock, signal))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBeInstanceOf(URL)
    expect(url.toString()).toBe('https://serpapi.com/search?engine=google&q=query+canary&num=3&hl=en&gl=us&tbs=qdr%3Aw&api_key=credential+canary%2F%2B%3F%26')
    expect(init).toEqual({ method: 'GET', headers: { Accept: 'application/json' }, signal, redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'serpapi', results: [
      { providerId: 'serpapi', providerRank: 1, title: 'SerpApi first result', url: 'https://docs.example.com/serpapi?q=search', domain: 'docs.example.com', displayUrl: 'docs.example.com › serpapi', snippet: 'A Google organic result.' },
      { providerId: 'serpapi', providerRank: 4, title: 'SerpApi fourth result', url: 'https://example.org/reference', domain: 'example.org', displayUrl: 'example.org › reference', snippet: 'The documented organic position is retained.' },
    ] })
    expect(JSON.stringify(outcome)).not.toContain(credential)
  })

  it.each([
    [{ ...request, language: 'EN' }, 'language'],
    [{ ...request, language: 'e'.repeat(100) }, 'oversized language'],
    [{ ...request, region: 'usa' }, 'region'],
    [{ ...request, safeSearch: 'strict' as const }, 'safe search'],
    [{ ...request, timeRange: 'forever' as never }, 'time range'],
    [{ ...request, limit: 0 }, 'limit'],
    [{ ...request, query: ` ${query}` }, 'query'],
  ])('rejects invalid or unsupported %s before fetch', async (candidate) => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(serpApiAdapter(candidate, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid credentials before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const contexts = [
      context(fetchMock, undefined, { credentials: { api_key: ` ${credential}` } }),
    ]
    for (const candidate of contexts) await expect(serpApiAdapter(request, candidate)).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts empty results and rejects provider error and status envelopes without leaks', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('{"organic_results":[]}'))
      .mockResolvedValueOnce(jsonResponse(`{"error":"${upstreamError}"}`))
      .mockResolvedValueOnce(jsonResponse(`{"search_metadata":{"status":"Error","message":"${upstreamError}"},"organic_results":[]}`))
    await expect(serpApiAdapter({ query, limit: 1 }, context(fetchMock))).resolves.toEqual({ ok: true, providerId: 'serpapi', results: [] })
    for (let index = 0; index < 2; index++) {
      const failed = await serpApiAdapter(request, context(fetchMock))
      expect(failed).toMatchObject({ ok: false, failure: { code: 'provider_error' } })
      expect(JSON.stringify(failed)).not.toContain(upstreamError)
    }
  })

  it('cancels rejected bodies and maps HTTP failures generically', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const limited = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429, headers: { 'Retry-After': '4' } })))
    expect(cancelled).toBe(true)
    expect(limited).toMatchObject({ failure: { code: 'provider_rate_limited', retryAfterMs: 4_000 } })
    for (const [status, code] of [[401, 'provider_authentication_failed'], [400, 'provider_rejected_request'], [503, 'provider_unavailable']] as const) {
      const outcome = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(upstreamError, { status })))
      expect(outcome).toMatchObject({ failure: { code, httpStatus: status } })
      expect(JSON.stringify(outcome)).not.toContain(upstreamError)
    }
  })

  it('maps network and aborted fetch failures without leaking request canaries', async () => {
    const network = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)))
    const controller = new AbortController(); controller.abort(upstreamError)
    const aborted = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)), request, controller.signal)
    expect(network).toMatchObject({ failure: { code: 'provider_unavailable' } })
    expect(aborted).toMatchObject({ failure: { code: 'provider_timeout' } })
    for (const canary of [credential, query, upstreamError]) expect(JSON.stringify([network, aborted])).not.toContain(canary)
  })

  it.each([
    [jsonResponse('{')],
    [jsonResponse('not json', { headers: { 'Content-Type': 'text/plain' } })],
    [jsonResponse(upstreamError, { headers: { 'Content-Length': String(PROVIDER_ADAPTER_LIMITS.responseBytes + 1) } })],
    [jsonResponse('{"unexpected":[]}')],
  ])('rejects malformed, non-JSON, oversized, and wrong-shape responses', async (response) => {
    const outcome = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(response))
    expect(outcome).toMatchObject({ failure: { code: 'provider_invalid_response' } })
    for (const canary of [credential, query, upstreamError]) expect(JSON.stringify(outcome)).not.toContain(canary)
  })
})
