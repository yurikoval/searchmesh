import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderDefinition } from '../src/schema.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/types.js'

vi.mock('../src/url-policy.js', () => ({
  getAdapterPolicy: (id: string) => id === 'perplexity' ? { origin: 'https://api.perplexity.ai', basePath: '/', path: '/search', method: 'POST' } : undefined,
}))

const { perplexityAdapter } = await import('../src/adapters/perplexity.js')
const fixtureSource = readFileSync(new URL('./fixtures/perplexity-search.json', import.meta.url), 'utf8')
const credential = 'credential-canary'
const query = 'query canary'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 3, language: 'en', region: 'US', timeRange: 'month' }
const definition: ProviderDefinition = {
  schema_version: '1', id: 'perplexity', name: 'Perplexity', description: 'Search provider.',
  website_url: 'https://example.com/', documentation_url: 'https://example.com/docs', adapter: 'perplexity', status: 'active', available: true, enabled_by_default: false,
  endpoint: { api_base_url: 'https://api.perplexity.ai/', method: 'POST', path: '/search' },
  capabilities: { operations: ['search'], optional_inputs: ['language', 'region', 'time_range'] },
  authentication: { credential_mode: 'user', fields: [{ name: 'api_key', label: 'API key' }] },
  request_mapping: { query: {}, body: { query: 'query', language: 'search_language_filter', region: 'country', time_range: 'search_recency_filter' } },
  response_mapping: { results: ['results'], title: ['title'], url: ['url'], snippet: ['snippet'] },
}

function context(fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { providerId: 'perplexity', definition: structuredClone(definition), credentials: { api_key: credential }, signal, fetch: fetchMock, ...overrides }
}
function jsonResponse(body = fixtureSource, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }) }
async function failureWith(fetchMock: typeof fetch, signal = new AbortController().signal) {
  const outcome = await perplexityAdapter(request, context(fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('Perplexity adapter', () => {
  it('sends the exact request and normalizes bounded results in upstream order', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const signal = new AbortController().signal
    const outcome = await perplexityAdapter(request, context(fetchMock, signal))
    expect(fetchMock).toHaveBeenCalledWith('https://api.perplexity.ai/search', {
      method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, signal, redirect: 'error',
      body: JSON.stringify({ query, max_results: 3, search_language_filter: ['en'], country: 'US', search_recency_filter: 'month' }),
    })
    expect(outcome).toEqual({ ok: true, providerId: 'perplexity', results: [
      { providerId: 'perplexity', providerRank: 1, title: 'Perplexity first result', url: 'https://docs.example.com/perplexity?q=search', domain: 'docs.example.com', snippet: 'A structured web result.', publishedAt: '2025-03-04T00:00:00.000Z' },
      { providerId: 'perplexity', providerRank: 3, title: 'Perplexity third result', url: 'https://example.org/reference', domain: 'example.org', snippet: 'Upstream order remains stable.' },
    ] })
  })

  it.each([
    [{ ...request, language: 'eng' }, 'language'],
    [{ ...request, language: 'e'.repeat(100) }, 'oversized language'],
    [{ ...request, region: 'usa' }, 'region'],
    [{ ...request, safeSearch: 'strict' as const }, 'safe search'],
    [{ ...request, limit: 0 }, 'limit'],
    [{ ...request, query: ` ${query}` }, 'query'],
  ])('rejects invalid or unsupported %s before fetch', async (candidate) => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(perplexityAdapter(candidate, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects context and credential mismatches before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const contexts = [
      context(fetchMock, undefined, { providerId: 'other' }),
      context(fetchMock, undefined, { definition: { ...definition, endpoint: { ...definition.endpoint, method: 'GET' } } }),
      context(fetchMock, undefined, { definition: { ...definition, request_mapping: { ...definition.request_mapping, body: { ...definition.request_mapping.body, region: 'region' } } } }),
      context(fetchMock, undefined, { credentials: { api_key: ` ${credential}` } }),
    ]
    for (const candidate of contexts) await expect(perplexityAdapter(request, candidate)).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns empty results and maps HTTP, network, and abort failures without leaks', async () => {
    await expect(perplexityAdapter({ query, limit: 1 }, context(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse('{"results":[]}'))))).resolves.toEqual({ ok: true, providerId: 'perplexity', results: [] })
    const rejected = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(upstreamError, { status: 422 })))
    const network = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)))
    const controller = new AbortController(); controller.abort(upstreamError)
    const aborted = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)), controller.signal)
    expect(rejected).toMatchObject({ failure: { code: 'provider_rejected_request', httpStatus: 422 } })
    expect(network).toMatchObject({ failure: { code: 'provider_unavailable' } })
    expect(aborted).toMatchObject({ failure: { code: 'provider_timeout' } })
    for (const canary of [credential, query, upstreamError]) expect(JSON.stringify([rejected, network, aborted])).not.toContain(canary)
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
