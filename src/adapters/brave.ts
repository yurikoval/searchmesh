import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { getAdapterPolicy } from '../url-policy.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'brave'
const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const OPTIONAL_MAPPINGS = { language: 'search_lang', region: 'country', safe_search: 'safesearch', time_range: 'freshness' } as const
const TIME_RANGE = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const

export const braveAdapter: ProviderAdapter = async (request, context) => {
  const configured = validContext(context)
  if (!configured || !validRequest(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, configured ? 'provider_unsupported_parameter' : 'provider_configuration_error') }

  const unsupported = unsupportedOption(request, context)
  if (unsupported) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }

  const url = new URL(ENDPOINT)
  url.searchParams.set('q', request.query)
  url.searchParams.set('count', String(request.limit))
  if (request.language) url.searchParams.set('search_lang', request.language)
  if (request.region) url.searchParams.set('country', request.region)
  if (request.safeSearch) url.searchParams.set('safesearch', request.safeSearch)
  if (request.timeRange) url.searchParams.set('freshness', TIME_RANGE[request.timeRange])

  let response: Response
  try {
    response = await (context.fetch ?? fetch)(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'X-Subscription-Token': context.credentials.api_key },
      signal: context.signal,
      redirect: 'error',
    })
  } catch { return { ok: false, failure: fetchFailure(PROVIDER_ID, context.signal) } }

  const failed = responseFailure(PROVIDER_ID, response)
  if (failed) { await cancelResponseBody(response); return { ok: false, failure: failed } }
  try {
    const payload = await readBoundedJson(response)
    return normalize(payload, request.limit)
  } catch (error) {
    return { ok: false, failure: error instanceof InvalidProviderResponse ? providerFailure(PROVIDER_ID, 'provider_invalid_response') : fetchFailure(PROVIDER_ID, context.signal) }
  }
}

function validContext(context: ProviderAdapterContext): boolean {
  const { definition } = context
  const policy = getAdapterPolicy(PROVIDER_ID)
  const optional = definition.capabilities.optional_inputs
  const expectedQuery = ['query', ...optional]
  const queryMapping = definition.request_mapping.query
  return context.providerId === PROVIDER_ID
    && definition.id === PROVIDER_ID
    && definition.adapter === PROVIDER_ID
    && definition.available
    && definition.status !== 'retired'
    && definition.endpoint.api_base_url === `${policy!.origin}${policy!.basePath}`
    && definition.endpoint.path === policy!.path
    && definition.endpoint.method === policy!.method
    && definition.capabilities.operations.length === 1
    && definition.capabilities.operations[0] === 'search'
    && optional.every((key) => OPTIONAL_MAPPINGS[key] === queryMapping[key])
    && Object.keys(queryMapping).length === expectedQuery.length
    && queryMapping.query === 'q'
    && Object.keys(definition.request_mapping.body).length === 0
    && definition.authentication.fields.length === 1
    && definition.authentication.fields[0].name === 'api_key'
    && Object.keys(context.credentials).length === 1
    && validCredential(context.credentials.api_key)
    && samePath(definition.response_mapping.results, ['web', 'results'])
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
  return (request.language !== undefined && (!supported.has('language') || !/^[a-z]{2,3}$/.test(request.language)))
    || (request.region !== undefined && (!supported.has('region') || !/^[A-Z]{2}$/.test(request.region)))
    || (request.safeSearch !== undefined && (!supported.has('safe_search') || !['off', 'moderate', 'strict'].includes(request.safeSearch)))
    || (request.timeRange !== undefined && (!supported.has('time_range') || !Object.hasOwn(TIME_RANGE, request.timeRange)))
}

function normalize(payload: unknown, limit: number): ProviderAdapterOutcome {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.web) || !Array.isArray(payload.web.results)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  const results: NormalizedSearchResult[] = []
  for (const [index, value] of payload.web.results.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
    if (!isPlainRecord(value)) continue
    const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters)
    const target = normalizedUrl(value.url)
    if (!title || !target) continue
    const profile = isPlainRecord(value.profile) ? value.profile : undefined
    const thumbnail = isPlainRecord(value.thumbnail) ? normalizedUrl(value.thumbnail.src) : undefined
    results.push(clean({
      providerId: PROVIDER_ID,
      providerRank: index + 1,
      title,
      ...target,
      displayUrl: boundedText(profile?.long_name, PROVIDER_ADAPTER_LIMITS.displayUrlCharacters),
      snippet: boundedText(value.description, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
      publishedAt: normalizedDate(value.page_age),
      imageUrl: thumbnail?.url,
      contentType: boundedText(value.type, PROVIDER_ADAPTER_LIMITS.contentTypeCharacters),
    }))
  }
  return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) }
}

function validCredential(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes
}
function samePath(actual: readonly (string | number)[] | undefined, expected: readonly (string | number)[]): boolean { return Boolean(actual) && actual!.length === expected.length && actual!.every((value, index) => value === expected[index]) }
function clean<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
