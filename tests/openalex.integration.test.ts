import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileStorage, RecordMode, VCR } from 'vcr-test'
import { openAlexAdapter, type ProviderAdapterOutcome } from '../src/index.js'

const credential = 'recorded-openalex-key'
if (process.env.VCR_MODE !== undefined && process.env.VCR_MODE !== RecordMode.none) throw new Error('OpenAlex integration tests only support VCR replay mode')
const vcr = new VCR(new FileStorage(fileURLToPath(new URL('./fixtures/cassettes', import.meta.url))))
vcr.mode = RecordMode.none
vcr.requestMasker = (request) => {
  const url = new URL(request.url)
  url.searchParams.set('api_key', credential)
  request.url = url.toString()
}

describe('OpenAlex recorded integration', () => {
  it('normalizes a recorded OpenAlex works search', async () => {
    let outcome: ProviderAdapterOutcome | undefined

    await vcr.useCassette('openalex-search', async () => {
      outcome = await openAlexAdapter(
        { query: 'OpenAlex scholarly search', limit: 3 },
        { credentials: { api_key: credential }, signal: new AbortController().signal },
      )
    })

    expect(outcome).toMatchObject({ ok: true, providerId: 'openalex' })
    if (!outcome?.ok) return
    expect(outcome.results.length).toBeGreaterThan(0)
    expect(outcome.results.length).toBeLessThanOrEqual(3)
    for (const result of outcome.results) {
      expect(result).toMatchObject({ providerId: 'openalex' })
      expect(result.providerRank).toBeGreaterThan(0)
      expect(result.providerRank).toBeLessThanOrEqual(3)
      expect(result.title).not.toBe('')
      expect(new URL(result.url).protocol).toBe('https:')
    }
  })
})
