import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { githubAdapter, PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/index.js'

const fixtureSource = readFileSync(new URL('./fixtures/github-search.json', import.meta.url), 'utf8')
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
  const outcome = await githubAdapter(request, context(fetchMock, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('GitHub adapter', () => {
  it('searches repository names, descriptions, and READMEs with the requested result limit', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse())
    const signal = new AbortController().signal
    const outcome = await githubAdapter(request, context(fetchMock, signal))

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url.toString()).toBe('https://api.github.com/search/repositories?q=query+canary+in%3Aname%2Cdescription%2Creadme+is%3Apublic&per_page=3')
    expect(init).toEqual({
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${credential}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal,
      redirect: 'manual',
    })
    expect(outcome).toEqual({ ok: true, providerId: 'github', results: [
      {
        providerId: 'github', providerRank: 1, title: 'example/searchmesh', url: 'https://github.com/example/searchmesh', domain: 'github.com',
        snippet: 'A runtime-neutral search adapter package.', contentType: 'repository', providerScore: 1.5,
        metadata: { name: 'searchmesh', fullName: 'example/searchmesh', stars: 321, language: 'TypeScript', topics: 'search, typescript, cloudflare-workers', updatedAt: '2026-10-18T12:34:56.000Z' },
      },
      {
        providerId: 'github', providerRank: 3, title: 'example/repository-search', url: 'https://github.com/example/repository-search', domain: 'github.com',
        contentType: 'repository', providerScore: 0.75,
        metadata: { name: 'repository-search', fullName: 'example/repository-search', stars: 42, language: 'Rust', topics: '', updatedAt: '2026-10-16T01:02:03.000Z' },
      },
    ] })
  })

  it('requests later result pages and preserves absolute provider ranks', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => jsonResponse())

    const outcome = await githubAdapter({ query, limit: 3, page: 2 }, context(fetchMock))
    const lastPage = await githubAdapter({ query, limit: 3, page: 334 }, context(fetchMock))

    expect(fetchMock.mock.calls[0][0].toString()).toBe('https://api.github.com/search/repositories?q=query+canary+in%3Aname%2Cdescription%2Creadme+is%3Apublic&per_page=3&page=2')
    expect(outcome.ok && outcome.results.map(({ providerRank }) => providerRank)).toEqual([4, 6])
    expect(lastPage.ok && lastPage.results.map(({ providerRank }) => providerRank)).toEqual([1_000])
  })

  it.each([
    [{ ...request, language: 'en' }, 'language'],
    [{ ...request, region: 'US' }, 'region'],
    [{ ...request, safeSearch: 'strict' }, 'safe search'],
    [{ ...request, timeRange: 'week' }, 'time range'],
    [{ ...request, limit: 0 }, 'limit'],
    [{ ...request, page: 0 }, 'page'],
    [{ ...request, page: 335 }, '1,000-result page ceiling'],
    [{ ...request, query: ` ${query}` }, 'untrimmed query'],
    [{ ...request, query: 'x'.repeat(257) }, 'query characters'],
    [{ ...request, query: 'one AND two OR three NOT four AND five OR six NOT seven' }, 'boolean operators'],
    [{ ...request, query: 'word '.repeat(PROVIDER_ADAPTER_LIMITS.queryWords + 1).trim() }, 'query words'],
  ])('rejects an unsupported or invalid %s before fetch', async (badRequest, _label) => {
    const fetchMock = vi.fn<typeof fetch>()
    await expect(githubAdapter(badRequest as NormalizedSearchRequest, context(fetchMock))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects invalid credentials before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const invalidCredentials: Array<Record<string, string>> = [{}, { api_key: ` ${credential}` }, { api_key: credential, extra: 'unexpected' }]
    for (const credentials of invalidCredentials) {
      await expect(githubAdapter(request, context(fetchMock, undefined, { credentials }))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_configuration_error' } })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns empty results and skips malformed entries without re-ranking', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse('{"total_count":0,"incomplete_results":false,"items":[]}'))
      .mockResolvedValueOnce(jsonResponse())
    await expect(githubAdapter({ query, limit: 1 }, context(fetchMock))).resolves.toEqual({ ok: true, providerId: 'github', results: [] })
    const partial = await githubAdapter(request, context(fetchMock))
    expect(partial.ok && partial.results.map(({ providerRank }) => providerRank)).toEqual([1, 3])
  })

  it('keeps only public GitHub repository URLs and bounds untrusted metadata', async () => {
    const [valid] = (JSON.parse(fixtureSource) as { items: Array<Record<string, unknown>> }).items
    const bounded = { ...valid, topics: Array.from({ length: 500 }, () => '界'.repeat(50)) }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(JSON.stringify({ items: [
      { ...valid, private: true },
      { ...valid, html_url: 'https://example.com/example/searchmesh' },
      { ...valid, html_url: 'http://github.com/example/searchmesh' },
      bounded,
    ] })))

    const outcome = await githubAdapter({ query, limit: 4 }, context(fetchMock))

    expect(outcome.ok && outcome.results.map(({ providerRank }) => providerRank)).toEqual([4])
    if (!outcome.ok) return
    const metadata = outcome.results[0].metadata
    expect(new TextEncoder().encode(JSON.stringify(metadata)).byteLength).toBeLessThanOrEqual(PROVIDER_ADAPTER_LIMITS.metadataBytes)
    expect(metadata).not.toHaveProperty('topics')
    expect(metadata).toHaveProperty('updatedAt')
  })

  it('maps GitHub primary and secondary rate limits and reset times without reading response bodies', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    try {
      const primary = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(body, {
        status: 403,
        headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '104' },
      })))
      const secondary = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 })))
      const tooMany = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429, headers: { 'X-RateLimit-Reset': '104' } })))
      expect(primary).toMatchObject({ failure: { code: 'provider_rate_limited', httpStatus: 403, retryAfterMs: 4_000 } })
      expect(secondary).toMatchObject({ failure: { code: 'provider_rate_limited', httpStatus: 403 } })
      expect(tooMany).toMatchObject({ failure: { code: 'provider_rate_limited', httpStatus: 429, retryAfterMs: 4_000 } })
      expect(cancelled).toBe(true)
    } finally {
      now.mockRestore()
    }
  })

  it.each([
    [401, {}, 'provider_authentication_failed'],
    [422, {}, 'provider_rejected_request'],
    [429, { 'Retry-After': '4' }, 'provider_rate_limited'],
    [503, {}, 'provider_unavailable'],
  ])('maps HTTP %i without exposing upstream content', async (status, headers, code) => {
    const outcome = await failureWith(vi.fn<typeof fetch>().mockResolvedValue(new Response(upstreamError, { status, headers })))
    expect(outcome).toMatchObject({ failure: { code, httpStatus: status } })
    if (status === 429) expect(outcome).toMatchObject({ failure: { retryAfterMs: 4_000 } })
    expect(JSON.stringify(outcome)).not.toContain(upstreamError)
  })

  it('maps network and aborted fetch failures without leaking canaries', async () => {
    const network = await failureWith(vi.fn<typeof fetch>().mockRejectedValue(new Error(upstreamError)))
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
