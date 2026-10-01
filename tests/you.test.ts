import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderDefinition } from '../src/schema.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/types.js'

vi.mock('../src/url-policy.js', () => ({
  getAdapterPolicy: (id: string) => id === 'you' ? { origin: 'https://ydc-index.io', basePath: '/v1/', path: '/v1/search', method: 'POST' } : undefined,
}))

const { youAdapter } = await import('../src/adapters/you.js')
const fixtureSource = readFileSync(new URL('./fixtures/you-search.json', import.meta.url), 'utf8')
const credential = 'credential-canary'
const query = 'query canary'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 3, language: 'pt-br', region: 'US', safeSearch: 'strict', timeRange: 'week' }
const definition: ProviderDefinition = {
  schema_version: '1', id: 'you', name: 'You.com', description: 'Search provider.',
  website_url: 'https://example.com/', documentation_url: 'https://example.com/docs', adapter: 'you', status: 'active', available: true, enabled_by_default: false,
  endpoint: { api_base_url: 'https://ydc-index.io/v1/', method: 'POST', path: '/v1/search' },
  capabilities: { operations: ['search'], optional_inputs: ['language', 'region', 'safe_search', 'time_range'] },
  authentication: { credential_mode: 'user', fields: [{ name: 'api_key', label: 'API key' }] },
  request_mapping: { query: {}, body: { query: 'query', language: 'language', region: 'country', safe_search: 'safesearch', time_range: 'freshness' } },
  response_mapping: { results: ['results', 'web'], title: ['title'], url: ['url'], snippet: ['description'] },
}

function context(fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { providerId: 'you', definition: structuredClone(definition), credentials: { api_key: credential }, signal, fetch: fetchMock, ...overrides }
}
function jsonResponse(body = fixtureSource, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }) }
async function failureWith(fetchMock: typeof fetch, signal = new AbortController().signal) {
  const outcome = await youAdapter(request, context(fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('You.com adapter', () => {
  it('sends the exact request and normalizes bounded results in upstream order', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const signal = new AbortController().signal
    const outcome = await youAdapter(request, context(fetchMock, signal))
    expect(fetchMock).toHaveBeenCalledWith('https://ydc-index.io/v1/search', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': credential }, signal, redirect: 'error',
      body: JSON.stringify({ query, count: 3, language: 'PT-BR', country: 'US', safesearch: 'strict', freshness: 'week' }),
    })
    expect(outcome).toEqual({ ok: true, providerId: 'you', results: [
      { providerId: 'you', providerRank: 1, title: 'You.com first result', url: 'https://docs.example.com/you?q=search', domain: 'docs.example.com', snippet: 'A structured web result.', publishedAt: '2025-03-04T00:00:00.000Z', imageUrl: 'https://cdn.example.com/you.png' },
      { providerId: 'you', providerRank: 3, title: 'You.com third result', url: 'https://example.org/reference', domain: 'example.org', snippet: 'Upstream order remains stable.' },
    ] })
  })

  it.each([
    [{ ...request, language: 'zz' }, 'unknown language'],
    [{ ...request, language: 'e'.repeat(100) }, 'oversized language'],
    [{ ...request, region: 'ZZ' }, 'unknown region'],
    [{ ...request, limit: 21 }, 'limit'],
    [{ ...request, query: `${query} ` }, 'query'],
  ])('rejects invalid %s before fetch', async (candidate) => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(youAdapter(candidate, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects definition, provider, mapping, and credential mismatches before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const contexts = [
      context(fetchMock, undefined, { providerId: 'other' }),
      context(fetchMock, undefined, { definition: { ...definition, endpoint: { ...definition.endpoint, path: '/other' } } }),
      context(fetchMock, undefined, { definition: { ...definition, request_mapping: { ...definition.request_mapping, body: { ...definition.request_mapping.body, region: 'region' } } } }),
      context(fetchMock, undefined, { credentials: { api_key: `${credential}\n` } }),
    ]
    for (const candidate of contexts) await expect(youAdapter(request, candidate)).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns empty results and maps HTTP, network, and abort failures without leaks', async () => {
    await expect(youAdapter({ query, limit: 1 }, context(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse('{"results":{"web":[]}}'))))).resolves.toEqual({ ok: true, providerId: 'you', results: [] })
    const limited = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(upstreamError, { status: 429, headers: { 'Retry-After': '4' } })))
    const network = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)))
    const controller = new AbortController(); controller.abort(upstreamError)
    const aborted = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)), controller.signal)
    expect(limited).toMatchObject({ failure: { code: 'provider_rate_limited', retryAfterMs: 4_000 } })
    expect(network).toMatchObject({ failure: { code: 'provider_unavailable' } })
    expect(aborted).toMatchObject({ failure: { code: 'provider_timeout' } })
    for (const canary of [credential, query, upstreamError]) expect(JSON.stringify([limited, network, aborted])).not.toContain(canary)
  })

  it.each([
    [jsonResponse('{')],
    [jsonResponse('not json', { headers: { 'Content-Type': 'text/plain' } })],
    [jsonResponse(upstreamError, { headers: { 'Content-Length': String(PROVIDER_ADAPTER_LIMITS.responseBytes + 1) } })],
    [jsonResponse('{"unexpected":[]}')],
  ])('rejects malformed, non-JSON, oversized, and wrong-shape responses', async (response) => {
    const outcome = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(response))
    expect(outcome).toMatchObject({ failure: { code: 'provider_invalid_response' } })
    expect(JSON.stringify(outcome)).not.toContain(upstreamError)
  })
})
