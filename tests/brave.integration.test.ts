import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileStorage, RecordMode, VCR } from 'vcr-test'
import { braveAdapter, type ProviderAdapterOutcome } from '../src/index.js'

const credential = 'recorded-brave-key'
if (process.env.VCR_MODE !== undefined && process.env.VCR_MODE !== RecordMode.none) throw new Error('Brave integration tests only support VCR replay mode')
const vcr = new VCR(new FileStorage(fileURLToPath(new URL('./fixtures/cassettes', import.meta.url))))
vcr.mode = RecordMode.none
vcr.requestMasker = (request) => { request.headers['x-subscription-token'] = 'recorded-brave-key' }

describe('Brave recorded integration', () => {
  it('normalizes a recorded live Brave search', async () => {
    let outcome: ProviderAdapterOutcome | undefined

    await vcr.useCassette('brave-search', async () => {
      outcome = await braveAdapter(
        { query: 'Brave Search API', limit: 3, language: 'en', region: 'US', safeSearch: 'moderate' },
        { credentials: { api_key: credential }, signal: new AbortController().signal },
      )
    })

    expect(outcome).toMatchObject({ ok: true, providerId: 'brave' })
    if (!outcome?.ok) return
    expect(outcome.results).toHaveLength(3)
    for (const [index, result] of outcome.results.entries()) {
      expect(result).toMatchObject({ providerId: 'brave', providerRank: index + 1 })
      expect(result.title).not.toBe('')
      expect(new URL(result.url).protocol).toBe('https:')
    }
  })
})
