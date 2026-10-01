import { describe, expect, it } from 'vitest'
import {
  InvalidProviderResponse,
  normalizedDate,
  normalizedUrl,
  parseRetryAfter,
  providerFailure,
  readBoundedJson,
  responseFailure,
  PROVIDER_ADAPTER_LIMITS,
} from '../src/index.js'

const jsonHeaders = { 'Content-Type': 'application/json' }

describe('provider response normalization', () => {
  it('reads streamed JSON without trusting chunk boundaries', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"items":['))
        controller.enqueue(encoder.encode('1,2]}'))
        controller.close()
      },
    })

    await expect(readBoundedJson(new Response(body, { headers: jsonHeaders }))).resolves.toEqual({ items: [1, 2] })
  })

  it.each([
    [new Response('{}', { headers: { 'Content-Type': 'text/plain' } }), 'non-JSON content'],
    [new Response('{', { headers: jsonHeaders }), 'malformed JSON'],
    [new Response('{}', { headers: { ...jsonHeaders, 'Content-Length': String(PROVIDER_ADAPTER_LIMITS.responseBytes + 1) } }), 'oversized declared body'],
    [new Response('{}', { headers: { ...jsonHeaders, 'Content-Length': 'unknown' } }), 'invalid declared length'],
  ])('rejects %s', async (response) => {
    await expect(readBoundedJson(response)).rejects.toBeInstanceOf(InvalidProviderResponse)
  })

  it.each([
    ['an invalid content type', { 'Content-Type': 'text/plain' }],
    ['an excessive declared length', { ...jsonHeaders, 'Content-Length': String(PROVIDER_ADAPTER_LIMITS.responseBytes + 1) }],
  ])('cancels the response body for %s', async (_reason, headers) => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })

    await expect(readBoundedJson(new Response(body, { headers }))).rejects.toBeInstanceOf(InvalidProviderResponse)
    expect(cancelled).toBe(true)
  })

  it('cancels a streamed body once its actual size exceeds the bound', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(PROVIDER_ADAPTER_LIMITS.responseBytes + 1)) },
      cancel() { cancelled = true },
    })

    await expect(readBoundedJson(new Response(body, { headers: jsonHeaders }))).rejects.toBeInstanceOf(InvalidProviderResponse)
    expect(cancelled).toBe(true)
  })

  it('normalizes safe URLs and dates and rejects unsafe values', () => {
    expect(normalizedUrl('https://Docs.Example.com/path?q=1')).toEqual({
      url: 'https://docs.example.com/path?q=1',
      domain: 'docs.example.com',
    })
    expect(normalizedUrl('https://user:secret@example.com/')).toBeUndefined()
    expect(normalizedUrl('javascript:alert(1)')).toBeUndefined()
    expect(normalizedUrl(`https://example.com/${'a'.repeat(PROVIDER_ADAPTER_LIMITS.urlCharacters)}`)).toBeUndefined()
    expect(normalizedDate('2025-02-03')).toBe('2025-02-03T00:00:00.000Z')
    expect(normalizedDate('2025-02-03T04:05:06+02:00')).toBe('2025-02-03T02:05:06.000Z')
    expect(normalizedDate('03/02/2025')).toBeUndefined()
  })

  it('parses bounded retry-after seconds and HTTP dates', () => {
    const now = Date.parse('2025-01-01T00:00:00Z')
    expect(parseRetryAfter('12', now)).toBe(12_000)
    expect(parseRetryAfter('Wed, 01 Jan 2025 00:00:30 GMT', now)).toBe(30_000)
    expect(parseRetryAfter('301', now)).toBeUndefined()
    expect(parseRetryAfter('not-a-date', now)).toBeUndefined()
  })

  it('maps status failures without exposing response or caller data', () => {
    const canaries = ['credential-canary', 'query-canary', 'upstream-error-canary']
    const response = new Response(canaries[2], { status: 429, headers: { 'Retry-After': '2' } })
    const failure = responseFailure('brave', response, 0)

    expect(failure).toEqual({
      providerId: 'brave',
      code: 'provider_rate_limited',
      retryable: true,
      message: 'Provider rate limit reached.',
      httpStatus: 429,
      retryAfterMs: 2_000,
    })
    const serializedFailures = JSON.stringify([failure, providerFailure('brave', 'provider_error')])
    for (const canary of canaries) expect(serializedFailures).not.toContain(canary)
  })
})
