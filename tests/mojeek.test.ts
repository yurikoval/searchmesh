import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/types.js'
import type { ProviderDefinition } from '../src/schema.js'

vi.mock('../src/url-policy.js', () => ({
  getAdapterPolicy: (id: string) => id === 'mojeek' ? { origin: 'https://api.mojeek.com', basePath: '/', path: '/search', method: 'GET' } : undefined,
}))

const { mojeekAdapter } = await import('../src/adapters/mojeek.js')
const fixtureSource = readFileSync(new URL('./fixtures/mojeek-search.json', import.meta.url), 'utf8')
const credential = 'credential canary/+?&'
const query = 'query canary'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 3, language: 'en', region: 'US' }
const definition: ProviderDefinition = {
  schema_version: '1', id: 'mojeek', name: 'Mojeek', description: 'Search provider.',
  website_url: 'https://example.com/', documentation_url: 'https://example.com/docs', adapter: 'mojeek', status: 'active', available: true, enabled_by_default: false,
  endpoint: { api_base_url: 'https://api.mojeek.com/', method: 'GET', path: '/search' },
  capabilities: { operations: ['search'], optional_inputs: ['language', 'region'] },
  authentication: { credential_mode: 'user', fields: [{ name: 'api_key', label: 'API key' }] },
  request_mapping: { query: { query: 'q', language: 'lb', region: 'rb' }, body: {} },
  response_mapping: { results: ['response', 'results'], title: ['title'], url: ['url'], snippet: ['desc'] },
}

function context(fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { providerId: 'mojeek', definition: structuredClone(definition), credentials: { api_key: credential }, signal, fetch: fetchMock, ...overrides }
}
function jsonResponse(body = fixtureSource, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }) }
async function failureWith(fetchMock: typeof fetch, candidate = request, signal = new AbortController().signal) {
  const outcome = await mojeekAdapter(candidate, context(fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('Mojeek adapter', () => {
  it('builds the exact credential-bearing runtime URL and normalizes bounded results', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const signal = new AbortController().signal
    const outcome = await mojeekAdapter(request, context(fetchMock, signal))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBeInstanceOf(URL)
    expect(url.toString()).toBe('https://api.mojeek.com/search?q=query+canary&t=3&fmt=json&lb=en&rb=US&api_key=credential+canary%2F%2B%3F%26')
    expect(init).toEqual({ method: 'GET', headers: { Accept: 'application/json' }, signal, redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'mojeek', results: [
      { providerId: 'mojeek', providerRank: 1, title: 'Mojeek first result', url: 'https://docs.example.com/mojeek?q=search', domain: 'docs.example.com', snippet: 'An independent search result.', imageUrl: 'https://cdn.example.com/mojeek.png', providerScore: 0.92 },
      { providerId: 'mojeek', providerRank: 3, title: 'Mojeek third result', url: 'https://example.org/reference', domain: 'example.org', snippet: 'Upstream order remains stable.' },
    ] })
    expect(JSON.stringify(outcome)).not.toContain(credential)
  })

  it.each([
    [{ ...request, language: 'EN' }, 'language'],
    [{ ...request, language: 'e'.repeat(100) }, 'oversized language'],
    [{ ...request, region: 'usa' }, 'region'],
    [{ ...request, safeSearch: 'strict' as const }, 'safe search'],
    [{ ...request, timeRange: 'week' as const }, 'time range'],
    [{ ...request, limit: 0 }, 'limit'],
    [{ ...request, query: ` ${query}` }, 'query'],
  ])('rejects invalid or unsupported %s before fetch', async (candidate) => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(mojeekAdapter(candidate, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects context and credentials before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const contexts = [
      context(fetchMock, undefined, { providerId: 'other' }),
      context(fetchMock, undefined, { definition: { ...definition, endpoint: { ...definition.endpoint, path: '/other' } } }),
      context(fetchMock, undefined, { definition: { ...definition, request_mapping: { ...definition.request_mapping, query: { query: 'query', language: 'lb', region: 'rb' } } } }),
      context(fetchMock, undefined, { credentials: { api_key: ` ${credential}` } }),
    ]
    for (const candidate of contexts) await expect(mojeekAdapter(request, candidate)).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts empty results and rejects provider-level errors without leaking content', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('{"response":{"status":"OK","results":[]}}'))
      .mockResolvedValueOnce(jsonResponse(`{"response":{"status":"ERROR","message":"${upstreamError}"}}`))
    await expect(mojeekAdapter({ query, limit: 1 }, context(fetchMock))).resolves.toEqual({ ok: true, providerId: 'mojeek', results: [] })
    const failed = await mojeekAdapter(request, context(fetchMock))
    expect(failed).toMatchObject({ ok: false, failure: { code: 'provider_error' } })
    expect(JSON.stringify(failed)).not.toContain(upstreamError)
  })

  it('cancels rejected bodies and maps HTTP failures generically', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429, headers: { 'Retry-After': '4' } })))
    expect(cancelled).toBe(true)
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
    [jsonResponse('{"response":{"status":"OK","unexpected":[]}}')],
  ])('rejects malformed, non-JSON, oversized, and wrong-shape responses', async (response) => {
    const outcome = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(response))
    expect(outcome).toMatchObject({ failure: { code: 'provider_invalid_response' } })
    for (const canary of [credential, query, upstreamError]) expect(JSON.stringify(outcome)).not.toContain(canary)
  })
})
