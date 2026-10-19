import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { gitlabAdapter, PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type ProviderAdapterContext } from '../src/index.js'

const fixture = readFileSync(new URL('./fixtures/gitlab-search.json', import.meta.url), 'utf8')
const credential = 'token-canary'
const query = 'search mesh'
const upstreamError = 'upstream-error-canary'
const request: NormalizedSearchRequest = { query, limit: 3 }
function context(fetch: typeof globalThis.fetch, credentials: Record<string, string> = {}, signal = new AbortController().signal): ProviderAdapterContext { return { credentials, signal, fetch } }
function json(body = fixture, init: ResponseInit = {}) { return new Response(body, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } }) }
async function failureWith(fetch: typeof globalThis.fetch, signal = new AbortController().signal) {
  const outcome = await gitlabAdapter(request, context(fetch, {}, signal))
  expect(outcome.ok).toBe(false)
  return outcome
}

describe('GitLab adapter', () => {
  it('sends the exact public request and normalizes metadata without reranking', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json())
    const signal = new AbortController().signal
    const outcome = await gitlabAdapter(request, context(fetch, {}, signal))

    expect(fetch.mock.calls[0][0].toString()).toBe('https://gitlab.com/api/v4/projects?search=search+mesh&visibility=public&per_page=3')
    expect(fetch.mock.calls[0][1]).toEqual({ method: 'GET', headers: { Accept: 'application/json' }, signal, redirect: 'manual' })
    expect(outcome).toEqual({ ok: true, providerId: 'gitlab', results: [
      { providerId: 'gitlab', providerRank: 1, title: 'GitLab / SearchMesh', url: 'https://gitlab.com/gitlab-org/searchmesh', domain: 'gitlab.com', snippet: 'A project search result.', publishedAt: '2025-02-03T04:05:06.000Z', metadata: { name: 'SearchMesh', namespace: 'gitlab-org', star_count: 12, forks_count: 3, topics: 'search, typescript', readme_url: 'https://gitlab.com/gitlab-org/searchmesh/-/blob/main/README.md' } },
      { providerId: 'gitlab', providerRank: 3, title: 'GitLab / Third', url: 'https://gitlab.com/gitlab-org/third', domain: 'gitlab.com' },
    ] })
  })

  it('authenticates optionally and maps activity ranges', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2025-03-01T00:00:00Z'))
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json('[]'))
      await gitlabAdapter({ ...request, timeRange: 'week' }, context(fetch, { api_key: credential }))
      expect(fetch.mock.calls[0][0].toString()).toBe('https://gitlab.com/api/v4/projects?search=search+mesh&visibility=public&per_page=3&last_activity_after=2025-02-22T00%3A00%3A00.000Z')
      expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Accept: 'application/json', 'PRIVATE-TOKEN': credential } })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    { ...request, page: 2 },
    { ...request, language: 'en' },
    { ...request, region: 'US' },
    { ...request, safeSearch: 'strict' },
    { ...request, timeRange: 'forever' },
    { ...request, limit: 0 },
    { ...request, query: ' search' },
  ] as NormalizedSearchRequest[])('rejects unsupported requests before fetch', async (bad) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    await expect(gitlabAdapter(bad, context(fetch))).resolves.toMatchObject({ ok: false, failure: { code: 'provider_unsupported_parameter' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed optional credentials before fetch', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    const invalid: Array<Record<string, string>> = [{ api_key: ` ${credential}` }, { api_key: '' }, { token: credential }, { api_key: credential, extra: credential }]
    for (const credentials of invalid) {
      await expect(gitlabAdapter(request, context(fetch, credentials))).resolves.toMatchObject({ failure: { code: 'provider_configuration_error' } })
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts empty results and bounds metadata bytes', async () => {
    const huge = '🧪'.repeat(PROVIDER_ADAPTER_LIMITS.metadataBytes)
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json('[]'))
      .mockResolvedValueOnce(json(JSON.stringify([{ name_with_namespace: 'Group / Project', name: huge, namespace: { full_path: huge }, web_url: 'https://gitlab.com/group/project', star_count: 1, forks_count: 2, topics: Array(20).fill(huge), readme_url: `https://gitlab.com/${'x'.repeat(1_900)}` }])))
    await expect(gitlabAdapter(request, context(fetch))).resolves.toEqual({ ok: true, providerId: 'gitlab', results: [] })
    const outcome = await gitlabAdapter(request, context(fetch))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.results).toHaveLength(1)
    expect(Object.keys(outcome.results[0].metadata ?? {})).toHaveLength(3)
    expect(new TextEncoder().encode(JSON.stringify(outcome.results[0].metadata)).byteLength).toBeLessThanOrEqual(PROVIDER_ADAPTER_LIMITS.metadataBytes)
  })

  it.each([
    [401, 'provider_authentication_failed'],
    [400, 'provider_rejected_request'],
    [429, 'provider_rate_limited'],
    [503, 'provider_unavailable'],
  ] as const)('maps HTTP %i without exposing upstream content', async (status, code) => {
    const outcome = await failureWith(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(upstreamError, { status, headers: { 'Retry-After': '4' } })))
    expect(outcome).toMatchObject({ failure: { code, httpStatus: status } })
    if (status === 429) expect(outcome).toMatchObject({ failure: { retryAfterMs: 4_000 } })
    expect(JSON.stringify(outcome)).not.toContain(upstreamError)
  })

  it('rejects redirects and cancels rejected response bodies', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
    const outcome = await failureWith(vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body, { status: 302, headers: { Location: 'https://redirect.example/canary' } })))
    expect(outcome).toMatchObject({ failure: { code: 'provider_error', httpStatus: 302 } })
    expect(cancelled).toBe(true)
    expect(JSON.stringify(outcome)).not.toContain('redirect.example')
  })

  it('maps network and aborted requests without leaking canaries', async () => {
    const network = await failureWith(vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(upstreamError)))
    const controller = new AbortController(); controller.abort(upstreamError)
    const aborted = await failureWith(vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(upstreamError)), controller.signal)
    expect(network).toMatchObject({ failure: { code: 'provider_unavailable' } })
    expect(aborted).toMatchObject({ failure: { code: 'provider_timeout' } })
    for (const canary of [query, upstreamError]) expect(JSON.stringify([network, aborted])).not.toContain(canary)
  })

  it.each([
    [json('{'), 'malformed JSON'],
    [new Response(upstreamError, { headers: { 'Content-Type': 'text/plain' } }), 'non-JSON response'],
    [json(upstreamError, { headers: { 'Content-Length': String(PROVIDER_ADAPTER_LIMITS.responseBytes + 1) } }), 'oversized response'],
    [json('{}'), 'wrong shape'],
  ])('rejects %s safely', async (response) => {
    const outcome = await failureWith(vi.fn<typeof globalThis.fetch>().mockResolvedValue(response))
    expect(outcome).toMatchObject({ failure: { code: 'provider_invalid_response' } })
    expect(JSON.stringify(outcome)).not.toContain(upstreamError)
  })
})
