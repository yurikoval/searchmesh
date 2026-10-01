import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  canonicalStringify,
  checksumCanonicalJson,
  isAllowedAdapterUrl,
  parseProviderYaml,
  validateProviderDefinition,
  validateProviderRevision,
} from '../src/index.js'

const validSource = readFileSync(new URL('./fixtures/valid.yaml', import.meta.url), 'utf8')
const encode = (value: string) => new TextEncoder().encode(value)
const parseValid = () => parseProviderYaml('providers/valid.yaml', encode(validSource))

describe('provider definition trust boundary', () => {
  it('parses, validates, normalizes, and hashes a valid definition deterministically', async () => {
    const parsed = parseValid()
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const validated = validateProviderDefinition('providers/valid.yaml', parsed.value)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    expect(validated.definition.available).toBe(true)
    expect(validated.definition.authentication.fields).toEqual([{ name: 'api_key', label: 'API key' }])
    expect(await checksumCanonicalJson(validated.canonicalJson)).toMatch(/^[a-f0-9]{64}$/)
    expect(canonicalStringify({ b: 1, a: { d: 2, c: 1 } })).toBe('{"a":{"c":1,"d":2},"b":1}')
    expect(canonicalStringify({ foobar: 1, foo_bar: 2 })).toBe('{"foo_bar":2,"foobar":1}')
  })

  it.each([
    ['duplicate keys', 'id: first\nid: second\n', 'malformed_yaml'],
    ['aliases', 'base: &base {name: test}\ncopy: *base\n', 'alias_not_allowed'],
    ['merge keys', 'base: &base {name: test}\ncopy:\n  <<: *base\n', 'merge_not_allowed'],
    ['custom tags', 'value: !unsafe thing\n', 'tag_not_allowed'],
    ['multiple documents', 'value: one\n---\nvalue: two\n', 'malformed_yaml'],
    ['non-finite numbers', 'value: .inf\n', 'invalid_number'],
  ])('rejects %s without returning source values', (_name, source, code) => {
    const result = parseProviderYaml('providers/bad.yaml', encode(source))
    expect(result).toEqual({ ok: false, errors: [expect.objectContaining({ file: 'providers/bad.yaml', code })] })
    expect(JSON.stringify(result)).not.toContain('thing')
    expect(JSON.stringify(result)).not.toContain('second')
  })

  it('rejects unsafe semantic fields and keeps errors redacted', () => {
    const parsed = parseValid()
    if (!parsed.ok) throw new Error('fixture failed to parse')
    const value = parsed.value as Record<string, unknown>
    value.endpoint = { api_base_url: 'https://127.0.0.1/', method: 'GET', path: '/../secret' }
    value.response_mapping = { results: ['__proto__'], title: ['title'], url: ['url'], snippet: ['snippet'] }
    value.unexpected = 'DO_NOT_REPEAT_THIS'

    const result = validateProviderDefinition('providers/valid.yaml', value)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map(({ code }) => code)).toEqual(expect.arrayContaining(['unknown_key', 'unsafe_url', 'unsafe_path', 'unsafe_path_segment']))
    expect(JSON.stringify(result.errors)).not.toContain('DO_NOT_REPEAT_THIS')
    expect(JSON.stringify(result.errors)).not.toContain('127.0.0.1')
  })

  it('redacts attacker-controlled keys and rejects stored secret examples', () => {
    const parserResult = parseProviderYaml('providers/bad.yaml', encode('ghp_AAAAAAAAAAAAAAAAAAAA: !unsafe value\n'))
    expect(parserResult.ok).toBe(false)
    expect(JSON.stringify(parserResult)).not.toContain('ghp_')

    const parsed = parseValid()
    if (!parsed.ok) throw new Error('fixture failed to parse')
    const value = parsed.value as Record<string, unknown>
    value.metadata = { example_request: { note: 'Bearer top-secret-credential' } }
    value['ghp_BBBBBBBBBBBBBBBBBBBB'] = 'hidden'
    const result = validateProviderDefinition('providers/valid.yaml', value)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map(({ code }) => code)).toEqual(expect.arrayContaining(['unknown_key', 'secret_like_value']))
    expect(JSON.stringify(result.errors)).not.toContain('ghp_')
    expect(JSON.stringify(result.errors)).not.toContain('top-secret-credential')
  })

  it.each([
    ['https://api.search.brave.com/res/v1/', '/admin'],
    ['https://api.search.brave.com/res/v1/web/search', '/res/v1/web/search'],
  ])('rejects endpoint base/path combinations outside the compiled adapter policy', (apiBaseUrl, path) => {
    const parsed = parseValid()
    if (!parsed.ok) throw new Error('fixture failed to parse')
    ;(parsed.value as Record<string, unknown>).endpoint = { api_base_url: apiBaseUrl, method: 'GET', path }
    const result = validateProviderDefinition('providers/valid.yaml', parsed.value)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.map(({ code }) => code)).toContain('adapter_origin_mismatch')
  })

  it('fails the entire revision on any invalid definition and makes unknown adapters unavailable', () => {
    const parsed = parseValid()
    if (!parsed.ok) throw new Error('fixture failed to parse')
    const unknown = structuredClone(parsed.value) as Record<string, unknown>
    unknown.id = 'unknown'
    unknown.adapter = 'future-adapter'

    const single = validateProviderDefinition('providers/unknown.yaml', unknown)
    expect(single.ok && single.definition.available).toBe(false)

    const revision = validateProviderRevision([
      { file: 'providers/unknown.yaml', value: unknown },
      { file: 'providers/bad.yaml', value: { schema_version: '1' } },
    ])
    expect(revision.ok).toBe(false)
  })

  it('enforces the compiled HTTPS origin, method, and exact path policy', () => {
    const policies = [
      ['brave', 'https://api.search.brave.com/res/v1/', 'https://api.search.brave.com/res/v1/web/search'],
      ['tavily', 'https://api.tavily.com/', 'https://api.tavily.com/search'],
      ['you', 'https://ydc-index.io/v1/', 'https://ydc-index.io/v1/search'],
      ['perplexity', 'https://api.perplexity.ai/', 'https://api.perplexity.ai/search'],
      ['mojeek', 'https://api.mojeek.com/', 'https://api.mojeek.com/search'],
      ['serpapi', 'https://serpapi.com/', 'https://serpapi.com/search'],
      ['dataforseo', 'https://api.dataforseo.com/v3/serp/google/organic/live/', 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced'],
    ] as const
    for (const [id, base, endpoint] of policies) {
      expect(isAllowedAdapterUrl(id, base)).toBe(true)
      expect(isAllowedAdapterUrl(id, endpoint)).toBe(true)
      expect(isAllowedAdapterUrl(id, `${endpoint}?api_key=secret`)).toBe(false)
      expect(isAllowedAdapterUrl(id, endpoint.replace(new URL(endpoint).hostname, 'example.com'))).toBe(false)
      expect(isAllowedAdapterUrl(id, `${base}other`)).toBe(false)
    }
    expect(isAllowedAdapterUrl('missing', 'https://api.search.brave.com/res/v1/')).toBe(false)

    for (const id of ['you', 'perplexity', 'mojeek', 'serpapi', 'dataforseo']) {
      const file = `providers/${id}.yaml`
      const parsed = parseProviderYaml(file, readFileSync(new URL(`../${file}`, import.meta.url)))
      if (!parsed.ok) throw new Error(`${file} failed to parse`)
      const value = parsed.value as Record<string, unknown>
      const endpoint = value.endpoint as Record<string, unknown>
      endpoint.method = endpoint.method === 'GET' ? 'POST' : 'GET'
      const result = validateProviderDefinition(file, value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.map(({ code }) => code)).toContain('adapter_origin_mismatch')
    }
  })
})
