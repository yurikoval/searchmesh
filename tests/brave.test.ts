import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  braveAdapter,
  providerAdapters,
  PROVIDER_ADAPTER_LIMITS,
  runProviderAdapter,
  type NormalizedSearchRequest,
  type ProviderAdapterContext,
  type ProviderDefinition,
} from '../src/index.js'

const fixtureSource = readFileSync(new URL('./fixtures/brave-search.json', import.meta.url), 'utf8')
const credential = 'credential-canary'
const query = 'query canary'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 3, language: 'en', region: 'US', safeSearch: 'strict', timeRange: 'week' }
const definition: ProviderDefinition = {
  schema_version: '1', id: 'brave', name: 'Brave', description: 'Search provider.',
  website_url: 'https://example.com/', documentation_url: 'https://example.com/docs', adapter: 'brave', status: 'active', available: true, enabled_by_default: true,
  endpoint: { api_base_url: 'https://api.search.brave.com/res/v1/', method: 'GET', path: '/res/v1/web/search' },
  capabilities: { operations: ['search'], optional_inputs: ['language', 'region', 'safe_search', 'time_range'] },
  authentication: { credential_mode: 'user', fields: [{ name: 'api_key', label: 'API key' }] },
  request_mapping: { query: { query: 'q', language: 'search_lang', region: 'country', safe_search: 'safesearch', time_range: 'freshness' }, body: {} },
  response_mapping: { results: ['web', 'results'], title: ['title'], url: ['url'], snippet: ['description'] },
}

function context(fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { providerId: 'brave', definition: structuredClone(definition), credentials: { api_key: credential }, signal, fetch: fetchMock, ...overrides }
}
function jsonResponse(body = fixtureSource, init: ResponseInit = {}) {
  return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
}

async function failureWith(fetchMock: typeof fetch, signal = new AbortController().signal) {
  const outcome = await braveAdapter(request, context(fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('Brave adapter', () => {
  it('exposes only the two compiled adapters and fails unknown adapters closed', async () => {
    expect(Object.keys(providerAdapters)).toEqual(['brave', 'tavily'])
    const fetchMock = vi.fn<typeof fetch>()
    await expect(runProviderAdapter('unknown', request, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the exact bounded request and normalizes valid results in upstream order', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const signal = new AbortController().signal
    const outcome = await braveAdapter(request, context(fetchMock, signal))

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url.toString()).toBe('https://api.search.brave.com/res/v1/web/search?q=query+canary&count=3&search_lang=en&country=US&safesearch=strict&freshness=pw')
    expect(init).toEqual({ method: 'GET', headers: { Accept: 'application/json', 'X-Subscription-Token': credential }, signal, redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'brave', results: [
      {
        providerId: 'brave', providerRank: 1, title: 'First result', url: 'https://docs.example.com/guide?topic=search', domain: 'docs.example.com',
        displayUrl: 'docs.example.com/guide', snippet: 'A concise search result.', publishedAt: '2025-02-03T04:05:06.000Z', imageUrl: 'https://cdn.example.com/first.png', contentType: 'article',
      },
      { providerId: 'brave', providerRank: 3, title: 'Third result', url: 'https://example.org/reference', domain: 'example.org', snippet: 'Order and upstream rank remain stable.' },
    ] })
  })

  it.each([
    [{ ...request, language: 'EN' }, 'unsupported language'],
    [{ ...request, safeSearch: 'unsafe' } as unknown as NormalizedSearchRequest, 'invalid safe search'],
    [{ ...request, timeRange: 'forever' } as unknown as NormalizedSearchRequest, 'invalid time range'],
    [{ ...request, limit: 0 }, 'invalid limit'],
    [{ ...request, query: ` ${query}` }, 'untrimmed query'],
  ])('rejects %s before fetch', async (badRequest) => {
    const fetchMock = vi.fn<typeof fetch>()
    const outcome = await braveAdapter(badRequest, context(fetchMock))
    expect(outcome).toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects definition, provider, mapping, and credential mismatches before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const contexts: ProviderAdapterContext[] = [
      context(fetchMock, undefined, { providerId: 'other' }),
      context(fetchMock, undefined, { definition: { ...definition, endpoint: { ...definition.endpoint, method: 'POST' } } }),
      context(fetchMock, undefined, { definition: { ...definition, response_mapping: { ...definition.response_mapping, title: ['name'] } } }),
      context(fetchMock, undefined, { credentials: { api_key: ` ${credential}` } }),
    ]
    for (const candidate of contexts) {
      await expect(braveAdapter(request, candidate)).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns empty results and skips malformed entries without re-ranking', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('{"web":{"results":[]}}'))
      .mockResolvedValueOnce(jsonResponse(fixtureSource))
    await expect(braveAdapter({ query, limit: 1 }, context(fetchMock))).resolves.toEqual({ ok: true, providerId: 'brave', results: [] })
    const partial = await braveAdapter(request, context(fetchMock))
    expect(partial.ok && partial.results.map(({ providerRank }) => providerRank)).toEqual([1, 3])
  })

  it('cancels non-success response bodies without reading them', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429 })))
    expect(cancelled).toBe(true)
  })

  it.each([
    [401, 'provider_authentication_failed'],
    [400, 'provider_rejected_request'],
    [429, 'provider_rate_limited'],
    [503, 'provider_unavailable'],
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

    const pendingController = new AbortController()
    const pendingFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('secret abort reason', 'AbortError')), { once: true })
    }))
    const pending = braveAdapter(request, context(pendingFetch, pendingController.signal))
    pendingController.abort()
    await expect(pending).resolves.toMatchObject({ ok: false, failure: { code: 'provider_timeout' } })
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
