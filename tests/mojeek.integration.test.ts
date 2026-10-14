import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FileStorage, RecordMode, VCR } from 'vcr-test'
import { mojeekAdapter, type ProviderAdapterOutcome } from '../src/index.js'

const credential = 'recorded-mojeek-key'
if (process.env.VCR_MODE !== undefined && process.env.VCR_MODE !== RecordMode.none) throw new Error('Mojeek integration tests only support VCR replay mode')
const vcr = new VCR(new FileStorage(fileURLToPath(new URL('./fixtures/cassettes', import.meta.url))))
vcr.mode = RecordMode.none
vcr.requestMasker = (request) => {
  const url = new URL(request.url)
  url.searchParams.set('api_key', credential)
  request.url = url.toString()
}

describe('Mojeek recorded integration', () => {
  it('normalizes a recorded live Mojeek search', async () => {
    let outcome: ProviderAdapterOutcome | undefined

    await vcr.useCassette('mojeek-search', async () => {
      outcome = await mojeekAdapter(
        { query: 'Mojeek search API', limit: 3, language: 'en', region: 'GB' },
        { credentials: { api_key: credential }, signal: new AbortController().signal },
      )
    })

    expect(outcome).toMatchObject({ ok: true, providerId: 'mojeek' })
    if (!outcome?.ok) return
    expect(outcome.results).toHaveLength(3)
    for (const [index, result] of outcome.results.entries()) {
      expect(result).toMatchObject({ providerId: 'mojeek', providerRank: index + 1 })
      expect(result.title).not.toBe('')
      expect(new URL(result.url).protocol).toBe('https:')
    }
  })
})
