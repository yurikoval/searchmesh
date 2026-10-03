import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/types.js'

vi.mock('../src/url-policy.js', () => ({
  getAdapterPolicy: (id: string) => id === 'dataforseo' ? { origin: 'https://api.dataforseo.com', basePath: '/v3/serp/google/organic/live/', path: '/v3/serp/google/organic/live/advanced', method: 'POST' } : undefined,
}))

const { dataForSeoAdapter } = await import('../src/adapters/dataforseo.js')
const fixtureSource = readFileSync(new URL('./fixtures/dataforseo-search.json', import.meta.url), 'utf8')
const login = 'login-canary'
const password = 'password-canary'
const query = 'query canary'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 3, language: 'fr' }
function context(fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { credentials: { login, password }, signal, fetch: fetchMock, ...overrides }
}
function jsonResponse(body = fixtureSource, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }) }
async function failureWith(fetchMock: typeof fetch, signal = new AbortController().signal) {
  const outcome = await dataForSeoAdapter(request, context(fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('DataForSEO adapter', () => {
  it('sends one bounded task with Basic auth and normalizes organic results only', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const signal = new AbortController().signal
    const outcome = await dataForSeoAdapter(request, context(fetchMock, signal))
    expect(fetchMock).toHaveBeenCalledWith('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
      method: 'POST', headers: { Accept: 'application/json', Authorization: `Basic ${btoa(`${login}:${password}`)}`, 'Content-Type': 'application/json' }, signal, redirect: 'error',
      body: JSON.stringify([{ keyword: query, location_code: 2840, language_code: 'fr', device: 'desktop', depth: 3 }]),
    })
    expect(outcome).toEqual({ ok: true, providerId: 'dataforseo', results: [
      { providerId: 'dataforseo', providerRank: 1, title: 'DataForSEO first result', url: 'https://docs.example.com/dataforseo?q=search', domain: 'docs.example.com', snippet: 'A Google organic result.' },
      { providerId: 'dataforseo', providerRank: 4, title: 'DataForSEO fourth result', url: 'https://example.org/reference', domain: 'example.org', snippet: 'Only organic items are normalized.' },
    ] })
  })

  it('defaults to English and keeps depth within the package result bound', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse('{"status_code":20000,"tasks":[{"status_code":20000,"result":[{"items":[]}]}]}'))
    await dataForSeoAdapter({ query, limit: PROVIDER_ADAPTER_LIMITS.results }, context(fetchMock))
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual([{ keyword: query, location_code: 2840, language_code: 'en', device: 'desktop', depth: PROVIDER_ADAPTER_LIMITS.results }])
  })

  it.each([
    [{ ...request, language: 'eng' }, 'language'],
    [{ ...request, language: 'e'.repeat(100) }, 'oversized language'],
    [{ ...request, region: 'US' }, 'region'],
    [{ ...request, safeSearch: 'moderate' as const }, 'safe search'],
    [{ ...request, timeRange: 'day' as const }, 'time range'],
    [{ ...request, limit: 21 }, 'limit'],
  ])('rejects invalid or unsupported %s before fetch', async (candidate) => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(dataForSeoAdapter(candidate, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires exact ASCII login/password credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const contexts = [
      context(fetchMock, undefined, { credentials: { login } }),
      context(fetchMock, undefined, { credentials: { login: `${login}:extra`, password } }),
      context(fetchMock, undefined, { credentials: { login, password: 'pässword' } }),
    ]
    for (const candidate of contexts) await expect(dataForSeoAdapter(request, candidate)).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects top-level and task-level HTTP-200 errors without leaking messages', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(`{"status_code":50000,"status_message":"${upstreamError}"}`))
      .mockResolvedValueOnce(jsonResponse(`{"status_code":20000,"tasks":[{"status_code":40000,"status_message":"${upstreamError}"}]}`))
    for (let index = 0; index < 2; index++) {
      const outcome = await dataForSeoAdapter(request, context(fetchMock))
      expect(outcome).toMatchObject({ ok: false, failure: { code: 'provider_error' } })
      expect(JSON.stringify(outcome)).not.toContain(upstreamError)
    }
  })

  it('maps HTTP, network, and abort failures without leaking canaries', async () => {
    const auth = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(upstreamError, { status: 401 })))
    const network = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)))
    const controller = new AbortController(); controller.abort(upstreamError)
    const aborted = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)), controller.signal)
    expect(auth).toMatchObject({ failure: { code: 'provider_authentication_failed' } })
    expect(network).toMatchObject({ failure: { code: 'provider_unavailable' } })
    expect(aborted).toMatchObject({ failure: { code: 'provider_timeout' } })
    for (const canary of [login, password, query, upstreamError]) expect(JSON.stringify([auth, network, aborted])).not.toContain(canary)
  })

  it.each([
    [jsonResponse('{')],
    [jsonResponse('not json', { headers: { 'Content-Type': 'text/plain' } })],
    [jsonResponse(upstreamError, { headers: { 'Content-Length': String(PROVIDER_ADAPTER_LIMITS.responseBytes + 1) } })],
    [jsonResponse('{"status_code":20000,"tasks":[]}')],
  ])('rejects malformed, non-JSON, oversized, and wrong-shape responses', async (response) => {
    const outcome = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(response))
    expect(outcome).toMatchObject({ failure: { code: 'provider_invalid_response' } })
    expect(JSON.stringify(outcome)).not.toContain(upstreamError)
  })
})
