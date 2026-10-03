import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'perplexity'
const ENDPOINT = 'https://api.perplexity.ai/search'
const TIME_RANGE = { day: 'day', week: 'week', month: 'month', year: 'year' } as const

export const perplexityAdapter: ProviderAdapter = async (request, context) => {
  if (!validContext(context)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') }
  if (!validRequest(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }
  if (unsupportedOption(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }

  let response: Response
  try {
    response = await (context.fetch ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${context.credentials.api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(clean({
        query: request.query,
        max_results: request.limit,
        search_language_filter: request.language ? [request.language] : undefined,
        country: request.region,
        search_recency_filter: request.timeRange && TIME_RANGE[request.timeRange],
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
  return (request.language !== undefined && !/^[a-z]{2}$/.test(request.language))
    || (request.region !== undefined && !/^[A-Z]{2}$/.test(request.region))
    || request.safeSearch !== undefined
    || (request.timeRange !== undefined && !Object.hasOwn(TIME_RANGE, request.timeRange))
}

function normalize(payload: unknown, limit: number): ProviderAdapterOutcome {
  if (!isPlainRecord(payload) || !Array.isArray(payload.results)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  const results: NormalizedSearchResult[] = []
  for (const [index, value] of payload.results.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
    if (!isPlainRecord(value)) continue
    const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters)
    const target = normalizedUrl(value.url)
    if (!title || !target) continue
    results.push(clean({
      providerId: PROVIDER_ID,
      providerRank: index + 1,
      title,
      ...target,
      snippet: boundedText(value.snippet, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
      publishedAt: normalizedDate(value.date),
    }))
  }
  return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) }
}

function validCredential(value: unknown): value is string { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes }
function clean<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
