import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseProviderYaml, runProviderAdapter, validateProviderRevision } from '../src/index.js'

const providerFiles = ['brave', 'tavily', 'yep', 'exa', 'kagi', 'you', 'perplexity', 'mojeek', 'serpapi', 'dataforseo'].map((id) => `providers/${id}.yaml`)

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
      'brave', 'dataforseo', 'exa', 'kagi', 'mojeek', 'perplexity', 'serpapi', 'tavily', 'yep', 'you',
    ])

    for (const { definition } of revision.definitions) {
      expect(definition).not.toHaveProperty('status')
      expect(definition).not.toHaveProperty('available')
      expect(definition).not.toHaveProperty('enabled_by_default')
      expect(definition.authentication).not.toHaveProperty('credential_mode')
      const credentials: Record<string, string> = definition.id === 'dataforseo' ? { login: 'test-login', password: 'test-password' } : { api_key: 'test-credential' }
      const outcome = await runProviderAdapter(definition.adapter, { query: 'package contract', limit: 1 }, {
        credentials,
        signal: new AbortController().signal,
        fetch: async () => Response.json(emptyPayloads[definition.id]),
      })
      expect(outcome).toEqual({ ok: true, providerId: definition.id, results: [] })
    }
  })
})
