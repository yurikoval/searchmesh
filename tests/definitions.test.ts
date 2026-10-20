import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { PROVIDER_CATEGORIES, parseProviderYaml, runProviderAdapter, validateProviderRevision } from '../src/index.js'

const providerFiles = ['brave', 'tavily', 'yep', 'exa', 'kagi', 'you', 'perplexity', 'mojeek', 'serpapi', 'dataforseo', 'gitlab', 'github', 'openalex', 'x'].map((id) => `providers/${id}.yaml`)
const categoriesByProvider = {
  brave: ['general-web', 'independent-index'],
  dataforseo: ['general-web', 'serp-data'],
  exa: ['semantic-search', 'ai-research'],
  github: ['general-web'],
  gitlab: ['general-web'],
  kagi: ['general-web'],
  mojeek: ['general-web', 'independent-index'],
  openalex: ['general-web'],
  perplexity: ['general-web', 'ai-research'],
  serpapi: ['general-web', 'serp-data'],
  tavily: ['semantic-search', 'ai-research'],
  x: ['general-web'],
  yep: ['general-web', 'independent-index'],
  you: ['general-web', 'ai-research'],
} as const

const emptyPayloads: Record<string, unknown> = {
  brave: { web: { results: [] } },
  tavily: { results: [] },
  yep: { results: [] },
  exa: { results: [] },
  kagi: { data: { search: [] } },
  you: { results: { web: [] } },
  perplexity: { results: [] },
  mojeek: { response: { status: 'OK', results: [] } },
  serpapi: { organic_results: [] },
  dataforseo: { status_code: 20000, tasks: [{ status_code: 20000, result: [{ items: [] }] }] },
  gitlab: [],
  github: { total_count: 0, incomplete_results: false, items: [] },
  openalex: { results: [] },
  x: { meta: { result_count: 0 } },
}

describe('published provider definitions', () => {
  it('ships one valid definition for every executable adapter', async () => {
    const parsed = await Promise.all(providerFiles.map(async (file) => {
      const result = parseProviderYaml(file, await readFile(new URL(`../${file}`, import.meta.url)))
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(`${file} did not parse`)
      return { file, value: result.value }
    }))

    const revision = validateProviderRevision(parsed)
    expect(revision.ok).toBe(true)
    if (!revision.ok) return
    expect(revision.definitions.map(({ definition }) => definition.id)).toEqual([
      'brave', 'dataforseo', 'exa', 'github', 'gitlab', 'kagi', 'mojeek', 'openalex', 'perplexity', 'serpapi', 'tavily', 'x', 'yep', 'you',
    ])

    for (const { definition } of revision.definitions) {
      expect(definition.categories).toEqual(categoriesByProvider[definition.id as keyof typeof categoriesByProvider])
      expect(new Set(definition.categories).size).toBe(definition.categories?.length)
      expect(definition.categories?.every((category) => PROVIDER_CATEGORIES.includes(category))).toBe(true)
      expect(new TextEncoder().encode(definition.description).length).toBeLessThanOrEqual(1_000)
      expect(definition.description.split(/\s+/).length).toBeGreaterThan(4)
      expect(definition).not.toHaveProperty('status')
      expect(definition).not.toHaveProperty('available')
      expect(definition).not.toHaveProperty('enabled_by_default')
      expect(definition.authentication).not.toHaveProperty('credential_mode')
      const credentials: Record<string, string> = definition.id === 'dataforseo' ? { login: 'test-login', password: 'test-password' } : definition.id === 'gitlab' ? {} : { api_key: 'test-credential' }
      const outcome = await runProviderAdapter(definition.adapter, { query: 'package contract', limit: 1 }, {
        credentials,
        signal: new AbortController().signal,
        fetch: async () => Response.json(emptyPayloads[definition.id]),
      })
      expect(outcome).toEqual({ ok: true, providerId: definition.id, results: [] })
    }
  })
})
