import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parseProviderYaml, runProviderAdapter, validateProviderRevision } from '../src/index.js'

const providerFiles = ['brave', 'tavily', 'yep', 'exa', 'kagi'].map((id) => `providers/${id}.yaml`)

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
    expect(revision.definitions.map(({ definition }) => definition.id)).toEqual(['brave', 'exa', 'kagi', 'tavily', 'yep'])

    for (const { definition } of revision.definitions) {
      const payload = definition.id === 'brave' ? { web: { results: [] } } : definition.id === 'kagi' ? { data: { search: [] } } : { results: [] }
      const outcome = await runProviderAdapter(definition.adapter, { query: 'package contract', limit: 1 }, {
        providerId: definition.id,
        definition,
        credentials: { api_key: 'test-credential' },
        signal: new AbortController().signal,
        fetch: async () => Response.json(payload),
      })
      expect(outcome).toEqual({ ok: true, providerId: definition.id, results: [] })
    }
  })
})
