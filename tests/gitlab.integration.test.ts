import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileStorage, RecordMode, VCR } from 'vcr-test'
import { gitlabAdapter, type ProviderAdapterOutcome } from '../src/index.js'

if (process.env.VCR_MODE !== undefined && process.env.VCR_MODE !== RecordMode.none) throw new Error('GitLab integration tests only support VCR replay mode')
const vcr = new VCR(new FileStorage(fileURLToPath(new URL('./fixtures/cassettes', import.meta.url))))
vcr.mode = RecordMode.none

describe('GitLab recorded integration', () => {
  it('normalizes a recorded public GitLab project search', async () => {
    let outcome: ProviderAdapterOutcome | undefined

    await vcr.useCassette('gitlab-search', async () => {
      outcome = await gitlabAdapter(
        { query: 'gitlab', limit: 3 },
        { credentials: {}, signal: new AbortController().signal },
      )
    })

    expect(outcome).toMatchObject({ ok: true, providerId: 'gitlab' })
    if (!outcome?.ok) return
    expect(outcome.results).toHaveLength(3)
    for (const [index, result] of outcome.results.entries()) {
      expect(result).toMatchObject({ providerId: 'gitlab', providerRank: index + 1 })
      expect(result.title).not.toBe('')
      expect(new URL(result.url).hostname).toBe('gitlab.com')
    }
  })
})
