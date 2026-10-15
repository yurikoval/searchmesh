import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileStorage, RecordMode, VCR } from 'vcr-test'
import { tavilyAdapter, type ProviderAdapterOutcome } from '../src/index.js'

const credential = 'recorded-tavily-key'
if (process.env.VCR_MODE !== undefined && process.env.VCR_MODE !== RecordMode.none) throw new Error('Tavily integration tests only support VCR replay mode')
const vcr = new VCR(new FileStorage(fileURLToPath(new URL('./fixtures/cassettes', import.meta.url))))
vcr.mode = RecordMode.none
vcr.requestMasker = (request) => {
  request.body = JSON.stringify({ ...JSON.parse(request.body), api_key: credential })
}

describe('Tavily recorded integration', () => {
  it('normalizes a recorded live Tavily search', async () => {
    let outcome: ProviderAdapterOutcome | undefined

    await vcr.useCassette('tavily-search', async () => {
      outcome = await tavilyAdapter(
        { query: 'Tavily Search API', limit: 3 },
        { credentials: { api_key: credential }, signal: new AbortController().signal },
      )
    })

    expect(outcome).toMatchObject({ ok: true, providerId: 'tavily' })
    if (!outcome?.ok) return
    expect(outcome.results).toHaveLength(3)
    for (const [index, result] of outcome.results.entries()) {
      expect(result).toMatchObject({ providerId: 'tavily', providerRank: index + 1 })
      expect(result.title).not.toBe('')
      expect(new URL(result.url).protocol).toBe('https:')
    }
  })
})
