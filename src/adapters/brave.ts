import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'brave'
const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'
const TIME_RANGE = { day: 'pd', week: 'pw', month: 'pm', year: 'py' } as const

export const braveAdapter: ProviderAdapter = async (request, context) => {
  if (!validContext(context)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') }
  if (!validRequest(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }

  const unsupported = unsupportedOption(request)
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
  return Object.keys(context.credentials).length === 1 && validCredential(context.credentials.api_key)
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

function unsupportedOption(request: NormalizedSearchRequest): boolean {
  return (request.language !== undefined && !/^[a-z]{2,3}$/.test(request.language))
    || (request.region !== undefined && !/^[A-Z]{2}$/.test(request.region))
    || (request.safeSearch !== undefined && !['off', 'moderate', 'strict'].includes(request.safeSearch))
    || (request.timeRange !== undefined && !Object.hasOwn(TIME_RANGE, request.timeRange))
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
function clean<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
