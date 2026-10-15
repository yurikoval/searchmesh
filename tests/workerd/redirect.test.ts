import { describe, expect, it } from 'vitest'
import { braveAdapter } from '../../src/index.js'

const credential = 'workerd-credential-canary'
const query = 'workerd-query-canary'

describe('workerd redirect handling', () => {
  it('surfaces a cross-origin redirect without following or replaying it', async () => {
    const outcome = await braveAdapter(
      { query, limit: 1 },
      { credentials: { api_key: credential }, signal: new AbortController().signal },
    )
    const requests = await (await fetch('https://assertions.test/counts')).json()

    expect(outcome).toEqual({
      ok: false,
      failure: {
        providerId: 'brave',
        code: 'provider_error',
        retryable: false,
        message: 'Provider request failed.',
        httpStatus: 302,
      },
    })
    expect(requests).toEqual({ provider: 1, target: 0 })
    for (const canary of [credential, query, 'location-canary', 'redirect-body-canary', 'redirect-target-canary']) {
      expect(JSON.stringify(outcome)).not.toContain(canary)
    }
  })
})
