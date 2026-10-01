import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { getAdapterPolicy } from '../url-policy.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'you'
const ENDPOINT = 'https://ydc-index.io/v1/search'
const LANGUAGES = new Set(['ar', 'eu', 'bn', 'bg', 'ca', 'zh-hans', 'zh-hant', 'hr', 'cs', 'da', 'nl', 'en', 'en-gb', 'et', 'fi', 'fr', 'gl', 'de', 'el', 'gu', 'he', 'hi', 'hu', 'is', 'it', 'ja', 'kn', 'ko', 'lv', 'lt', 'ms', 'ml', 'mr', 'nb', 'pl', 'pt-br', 'pt-pt', 'pa', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi'])
const REGIONS = new Set(['AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'HK', 'IN', 'ID', 'IT', 'JP', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US'])
const TIME_RANGE = { day: 'day', week: 'week', month: 'month', year: 'year' } as const

export const youAdapter: ProviderAdapter = async (request, context) => {
  const configured = validContext(context)
  if (!configured || !validRequest(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, configured ? 'provider_unsupported_parameter' : 'provider_configuration_error') }
  if (unsupportedOption(request, context)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }

  let response: Response
  try {
    response = await (context.fetch ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': context.credentials.api_key },
      body: JSON.stringify(clean({
        query: request.query,
        count: request.limit,
        language: request.language?.toUpperCase(),
        country: request.region,
        safesearch: request.safeSearch,
        freshness: request.timeRange && TIME_RANGE[request.timeRange],
      })),
      signal: context.signal,
      redirect: 'error',
    })
  } catch { return { ok: false, failure: fetchFailure(PROVIDER_ID, context.signal) } }

  const failed = responseFailure(PROVIDER_ID, response)
  if (failed) { await cancelResponseBody(response); return { ok: false, failure: failed } }
  try { return normalize(await readBoundedJson(response), request.limit) }
  catch (error) { return { ok: false, failure: error instanceof InvalidProviderResponse ? providerFailure(PROVIDER_ID, 'provider_invalid_response') : fetchFailure(PROVIDER_ID, context.signal) } }
}

function validContext(context: ProviderAdapterContext): boolean {
  const { definition } = context
  const policy = getAdapterPolicy(PROVIDER_ID)
  return Boolean(policy)
    && context.providerId === PROVIDER_ID
    && definition.id === PROVIDER_ID
    && definition.adapter === PROVIDER_ID
    && definition.available
    && definition.status !== 'retired'
    && definition.endpoint.api_base_url === `${policy!.origin}${policy!.basePath}`
    && definition.endpoint.path === policy!.path
    && definition.endpoint.method === policy!.method
    && sameValues(definition.capabilities.operations, ['search'])
    && sameValues(definition.capabilities.optional_inputs, ['language', 'region', 'safe_search', 'time_range'])
    && Object.keys(definition.request_mapping.query).length === 0
    && sameKeys(definition.request_mapping.body, ['query', 'language', 'region', 'safe_search', 'time_range'])
    && definition.request_mapping.body.query === 'query'
    && definition.request_mapping.body.language === 'language'
    && definition.request_mapping.body.region === 'country'
    && definition.request_mapping.body.safe_search === 'safesearch'
    && definition.request_mapping.body.time_range === 'freshness'
    && definition.authentication.fields.length === 1
    && definition.authentication.fields[0].name === 'api_key'
    && Object.keys(context.credentials).length === 1
    && validCredential(context.credentials.api_key)
    && samePath(definition.response_mapping.results, ['results', 'web'])
    && samePath(definition.response_mapping.title, ['title'])
    && samePath(definition.response_mapping.url, ['url'])
    && samePath(definition.response_mapping.snippet, ['description'])
    && definition.response_mapping.rank === undefined
}

function validRequest(request: NormalizedSearchRequest): boolean {
  return request.query === request.query.trim()
    && request.query.length > 0
    && request.query.length <= PROVIDER_ADAPTER_LIMITS.queryCharacters
    && request.query.split(/\s+/).length <= PROVIDER_ADAPTER_LIMITS.queryWords
    && Number.isInteger(request.limit)
    && request.limit >= 1
    && request.limit <= PROVIDER_ADAPTER_LIMITS.results
}

function unsupportedOption(request: NormalizedSearchRequest, context: ProviderAdapterContext): boolean {
  const supported = new Set(context.definition.capabilities.optional_inputs)
  return (request.language !== undefined && (!supported.has('language') || !LANGUAGES.has(request.language)))
    || (request.region !== undefined && (!supported.has('region') || !REGIONS.has(request.region)))
    || (request.safeSearch !== undefined && (!supported.has('safe_search') || !['off', 'moderate', 'strict'].includes(request.safeSearch)))
    || (request.timeRange !== undefined && (!supported.has('time_range') || !Object.hasOwn(TIME_RANGE, request.timeRange)))
}

function normalize(payload: unknown, limit: number): ProviderAdapterOutcome {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.results) || !Array.isArray(payload.results.web)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  const results: NormalizedSearchResult[] = []
  for (const [index, value] of payload.results.web.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
    if (!isPlainRecord(value)) continue
    const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters)
    const target = normalizedUrl(value.url)
    if (!title || !target) continue
    results.push(clean({
      providerId: PROVIDER_ID,
      providerRank: index + 1,
      title,
      ...target,
      snippet: boundedText(value.description, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
      publishedAt: normalizedDate(value.page_age),
      imageUrl: normalizedUrl(value.thumbnail_url)?.url,
    }))
  }
  return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) }
}

function validCredential(value: unknown): value is string { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes }
function samePath(actual: readonly (string | number)[] | undefined, expected: readonly (string | number)[]): boolean { return Boolean(actual) && actual!.length === expected.length && actual!.every((value, index) => value === expected[index]) }
function sameKeys(value: object, expected: readonly string[]): boolean { const keys = Object.keys(value); return keys.length === expected.length && expected.every((key) => keys.includes(key)) }
function sameValues(actual: readonly string[], expected: readonly string[]): boolean { return actual.length === expected.length && expected.every((value) => actual.includes(value)) }
function clean<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
