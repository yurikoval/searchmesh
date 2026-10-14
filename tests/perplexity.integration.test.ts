import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileStorage, RecordMode, VCR } from 'vcr-test'
import { perplexityAdapter, type ProviderAdapterOutcome } from '../src/index.js'

const credential = 'recorded-perplexity-key'
if (process.env.VCR_MODE !== undefined && process.env.VCR_MODE !== RecordMode.none) throw new Error('Perplexity integration tests only support VCR replay mode')
const vcr = new VCR(new FileStorage(fileURLToPath(new URL('./fixtures/cassettes', import.meta.url))))
vcr.mode = RecordMode.none
vcr.requestMasker = (request) => { request.headers.authorization = 'Bearer recorded-perplexity-key' }

describe('Perplexity recorded integration', () => {
  it('normalizes a recorded live Perplexity search', async () => {
    let outcome: ProviderAdapterOutcome | undefined

    await vcr.useCassette('perplexity-search', async () => {
      outcome = await perplexityAdapter(
        { query: 'Perplexity Search API', limit: 3, language: 'en', region: 'US' },
        { credentials: { api_key: credential }, signal: new AbortController().signal },
      )
    })

    expect(outcome).toMatchObject({ ok: true, providerId: 'perplexity' })
    if (!outcome?.ok) return
    expect(outcome.results.length).toBeGreaterThan(0)
    expect(outcome.results.length).toBeLessThanOrEqual(3)
    for (const result of outcome.results) {
      expect(result).toMatchObject({ providerId: 'perplexity' })
      expect(result.providerRank).toBeGreaterThan(0)
      expect(result.providerRank).toBeLessThanOrEqual(3)
      expect(result.title).not.toBe('')
      expect(new URL(result.url).protocol).toBe('https:')
    }
  })
})
