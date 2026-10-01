import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { exaAdapter, kagiAdapter, parseProviderYaml, yepAdapter, type ExecutableProviderId, type ProviderAdapter, type ProviderAdapterContext, type ProviderDefinition } from '../src/index.js'

const credential = 'credential-canary'
const request = { query: 'search query', limit: 2 } as const

function definition(id: ExecutableProviderId): ProviderDefinition {
  const file = `providers/${id}.yaml`
  const result = parseProviderYaml(file, readFileSync(new URL(`../${file}`, import.meta.url)))
  if (!result.ok) throw new Error(`${file} did not parse`)
  return result.value as ProviderDefinition
}

function context(id: ExecutableProviderId, fetchMock: typeof fetch): ProviderAdapterContext {
  return { providerId: id, definition: definition(id), credentials: { api_key: credential }, signal: new AbortController().signal, fetch: fetchMock }
}

async function run(adapter: ProviderAdapter, id: ExecutableProviderId, payload: unknown) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload))
  const outcome = await adapter(request, context(id, fetchMock))
  expect(fetchMock).toHaveBeenCalledOnce()
  return { outcome, call: fetchMock.mock.calls[0] }
}

describe('additional provider adapters', () => {
  it('sends and normalizes a Yep search', async () => {
    const { outcome, call: [url, init] } = await run(yepAdapter, 'yep', { results: [{ title: 'Yep result', url: 'https://yep.example/page', description: 'Result text', published_date: '2026-01-02' }] })
    expect(url.toString()).toBe('https://platform.yep.com/api/search')
    expect(init).toMatchObject({ method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: request.query, type: 'basic', limit: request.limit }), redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'yep', results: [{ providerId: 'yep', providerRank: 1, title: 'Yep result', url: 'https://yep.example/page', domain: 'yep.example', snippet: 'Result text', publishedAt: '2026-01-02T00:00:00.000Z' }] })
  })

  it('sends and normalizes an Exa search', async () => {
    const { outcome, call: [url, init] } = await run(exaAdapter, 'exa', { results: [{ title: 'Exa result', url: 'https://exa.example/page', text: 'Extracted text', publishedDate: '2026-01-02T03:04:05Z', author: 'Author' }] })
    expect(url.toString()).toBe('https://api.exa.ai/search')
    expect(init).toMatchObject({ method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': credential }, body: JSON.stringify({ query: request.query, numResults: request.limit, type: 'auto', contents: { text: { maxCharacters: 4000 } } }), redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'exa', results: [{ providerId: 'exa', providerRank: 1, title: 'Exa result', url: 'https://exa.example/page', domain: 'exa.example', snippet: 'Extracted text', publishedAt: '2026-01-02T03:04:05.000Z', author: 'Author' }] })
  })

  it('sends and normalizes a Kagi v1 search once', async () => {
    const { outcome, call: [url, init] } = await run(kagiAdapter, 'kagi', { data: { search: [{ title: 'Kagi result', url: 'https://kagi.example/page', snippet: 'Result text', time: '2026-01-02' }] } })
    expect(url.toString()).toBe('https://kagi.com/api/v1/search')
    expect(init).toMatchObject({ method: 'POST', headers: { Accept: 'application/json', Authorization: `Bot ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: request.query, workflow: 'search', limit: request.limit }), redirect: 'error' })
    expect(outcome).toEqual({ ok: true, providerId: 'kagi', results: [{ providerId: 'kagi', providerRank: 1, title: 'Kagi result', url: 'https://kagi.example/page', domain: 'kagi.example', snippet: 'Result text', publishedAt: '2026-01-02T00:00:00.000Z' }] })
  })
})
