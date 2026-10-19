import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileStorage, RecordMode, VCR } from 'vcr-test'
import { githubAdapter, type ProviderAdapterOutcome } from '../src/index.js'

const credential = 'recorded-github-token'
if (process.env.VCR_MODE !== undefined && process.env.VCR_MODE !== RecordMode.none) throw new Error('GitHub integration tests only support VCR replay mode')
const vcr = new VCR(new FileStorage(fileURLToPath(new URL('./fixtures/cassettes', import.meta.url))))
vcr.mode = RecordMode.none
vcr.requestMasker = (request) => { request.headers.authorization = 'Bearer recorded-github-token' }

describe('GitHub recorded integration', () => {
  it('normalizes a recorded live GitHub repository search', async () => {
    let outcome: ProviderAdapterOutcome | undefined

    await vcr.useCassette('github-search', async () => {
      outcome = await githubAdapter(
        { query: 'GitHub REST API', limit: 3 },
        { credentials: { api_key: credential }, signal: new AbortController().signal },
      )
    })

    expect(outcome).toMatchObject({ ok: true, providerId: 'github' })
    if (!outcome?.ok) return
    expect(outcome.results).toHaveLength(3)
    for (const [index, result] of outcome.results.entries()) {
      expect(result).toMatchObject({
        providerId: 'github',
        providerRank: index + 1,
        contentType: 'repository',
        metadata: { name: expect.any(String), fullName: expect.any(String), stars: expect.any(Number), updatedAt: expect.any(String) },
      })
      expect(result.title).not.toBe('')
      expect(new URL(result.url).hostname).toBe('github.com')
    }
  })
})
