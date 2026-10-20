import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { openAlexAdapter, PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/index.js'

const fixture = readFileSync(new URL('./fixtures/openalex-search.json', import.meta.url), 'utf8')
const credential = 'credential-canary'
const request: NormalizedSearchRequest = { query: 'query canary', limit: 2 }

function context(fetchMock: typeof fetch, signal = new AbortController().signal, overrides: Partial<ProviderAdapterContext> = {}): ProviderAdapterContext {
  return { credentials: { api_key: credential }, signal, fetch: fetchMock, ...overrides }
}

function jsonResponse(body = fixture, init: ResponseInit = {}) {
  return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
}

describe('OpenAlex adapter', () => {
  it('searches works, pages results, and normalizes scholarly metadata', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const outcome = await openAlexAdapter({ ...request, page: 2 }, context(fetchMock))

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://api.openalex.org/works?search=query+canary&per-page=2&api_key=credential-canary&page=2'),
      expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' }, redirect: 'manual' }),
    )
    expect(outcome).toEqual({ ok: true, providerId: 'openalex', results: [{
      providerId: 'openalex', providerRank: 3, title: 'OpenAlex result', url: 'https://example.org/article', domain: 'example.org',
      snippet: 'Abstract result', publishedAt: '2026-01-02T00:00:00.000Z', author: 'Example Author', contentType: 'article', providerScore: 0.95,
    }] })
  })

  it.each([
    [{ ...request, language: 'en' }, 'language'],
    [{ ...request, region: 'US' }, 'region'],
    [{ ...request, safeSearch: 'strict' }, 'safe search'],
    [{ ...request, timeRange: 'week' }, 'time range'],
    [{ ...request, page: 0 }, 'page'],
    [{ ...request, page: 5_001 }, 'page ceiling'],
    [{ ...request, limit: PROVIDER_ADAPTER_LIMITS.results + 1 }, 'limit'],
  ])('rejects unsupported %s before fetch', async (badRequest, _label) => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(openAlexAdapter(badRequest as NormalizedSearchRequest, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to a valid OA location or DOI and bounds abstract tokens', async () => {
    const result = JSON.parse(fixture).results[0]
    result.primary_location.landing_page_url = 'https://'
    result.best_oa_location = { landing_page_url: 'https://example.org/open-access' }
    result.abstract_inverted_index = { ['x'.repeat(10_000)]: [0] }
    const outcome = await openAlexAdapter(request, context(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(JSON.stringify({ results: [result] })))))
    expect(outcome).toMatchObject({ ok: true, results: [{ url: 'https://example.org/open-access' }] })
    if (outcome.ok) expect(outcome.results[0].snippet?.length).toBeLessThanOrEqual(100)
  })

  it('does not fetch with invalid credentials or responses', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(openAlexAdapter(request, context(fetchMock, undefined, { credentials: {} }))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    await expect(openAlexAdapter(request, context(fetchMock, undefined, { credentials: { api_key: `${credential}\n` } }))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    expect(fetchMock).not.toHaveBeenCalled()

    const malformed = await openAlexAdapter(request, context(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse('{'))))
    expect(malformed).toMatchObject({ ok: false, failure: { code: 'provider_invalid_response' } })
  })
})
