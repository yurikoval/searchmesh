import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileStorage, RecordMode, VCR } from 'vcr-test'
import { xAdapter, type ProviderAdapterOutcome } from '../src/index.js'

const credential = 'recorded-x-token'
if (process.env.VCR_MODE !== undefined && process.env.VCR_MODE !== RecordMode.none) throw new Error('X integration tests only support VCR replay mode')
const vcr = new VCR(new FileStorage(fileURLToPath(new URL('./fixtures/cassettes', import.meta.url))))
vcr.mode = RecordMode.none
vcr.requestMasker = (request) => { request.headers.authorization = 'Bearer recorded-x-token' }

describe('X recorded integration', () => {
  it('normalizes a recorded live full-archive post search', async () => {
    let outcome: ProviderAdapterOutcome | undefined

    await vcr.useCassette('x-search', async () => {
      outcome = await xAdapter(
        { query: 'TypeScript lang:uk -is:retweet', limit: 3 },
        { credentials: { api_key: credential }, signal: new AbortController().signal },
      )
    })

    expect(outcome).toMatchObject({ ok: true, providerId: 'x' })
    if (!outcome?.ok) return
    expect(outcome.results).toHaveLength(3)
    for (const [index, result] of outcome.results.entries()) {
      expect(result).toMatchObject({ providerId: 'x', providerRank: index + 1, contentType: 'post' })
      expect(result.title).not.toBe('')
      expect(new URL(result.url).hostname).toBe('x.com')
    }
  })
})
