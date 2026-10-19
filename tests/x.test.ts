import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { xAdapter, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/index.js'

const fixture = readFileSync(new URL('./fixtures/x-search.json', import.meta.url), 'utf8')
const credential = 'credential-canary'
const request: NormalizedSearchRequest = { query: 'Україна lang:uk -is:retweet', limit: 2 }
function context(fetchMock: typeof fetch, credentials = { api_key: credential }): ProviderAdapterContext {
  return { credentials, signal: new AbortController().signal, fetch: fetchMock }
}

describe('X adapter', () => {
  it('sends a search-all request and normalizes UTF-8 posts', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(fixture, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }))
    const outcome = await xAdapter(request, context(fetchMock))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url.toString()).toBe('https://api.x.com/2/tweets/search/all?query=%D0%A3%D0%BA%D1%80%D0%B0%D1%97%D0%BD%D0%B0+lang%3Auk+-is%3Aretweet&max_results=10&tweet.fields=created_at%2Cauthor_id%2Ctext')
    expect(init).toEqual({ method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${credential}` }, signal: expect.any(AbortSignal), redirect: 'manual' })
    expect(outcome).toEqual({ ok: true, providerId: 'x', results: [
      { providerId: 'x', providerRank: 1, title: 'Пошук українських дописів працює — без escaped Unicode.', url: 'https://x.com/i/web/status/1847595112662937840', domain: 'x.com', snippet: 'Пошук українських дописів працює — без escaped Unicode.', publishedAt: '2026-10-19T04:00:00.000Z', contentType: 'post', metadata: { id: '1847595112662937840', authorId: '2244994945' } },
      { providerId: 'x', providerRank: 2, title: '日本語の投稿もUTF-8で読みやすく保存されます。', url: 'https://x.com/i/web/status/1847595112662937841', domain: 'x.com', snippet: '日本語の投稿もUTF-8で読みやすく保存されます。', publishedAt: '2026-10-19T03:59:00.000Z', contentType: 'post', metadata: { id: '1847595112662937841', authorId: '2244994946' } },
    ] })
  })

  it('accepts an empty search response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ meta: { result_count: 0 } }))
    await expect(xAdapter(request, context(fetchMock))).resolves.toEqual({ ok: true, providerId: 'x', results: [] })
  })

  it.each([
    [{ ...request, page: 2 }, 'page'],
    [{ ...request, language: 'uk' }, 'language'],
    [{ ...request, limit: 0 }, 'limit'],
    [{ ...request, query: ` ${request.query}` }, 'query'],
  ])('rejects unsupported %s input before fetch', async (badRequest) => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(xAdapter(badRequest, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid credentials and malformed responses', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(xAdapter(request, context(fetchMock, { api_key: ` ${credential}` }))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue(new Response('{', { headers: { 'Content-Type': 'application/json' } }))
    await expect(xAdapter(request, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_invalid_response' } })
  })

  it('maps upstream failures without exposing the response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('upstream-secret', { status: 429, headers: { 'Retry-After': '4' } }))
    const outcome = await xAdapter(request, context(fetchMock))
    expect(outcome).toMatchObject({ ok: false, failure: { code: 'provider_rate_limited', httpStatus: 429, retryAfterMs: 4_000 } })
    expect(JSON.stringify(outcome)).not.toContain('upstream-secret')
  })
})
