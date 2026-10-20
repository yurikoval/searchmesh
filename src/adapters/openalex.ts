import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, finiteNumber, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'openalex'
const ENDPOINT = 'https://api.openalex.org/works'
const MAX_RESULTS = 10_000

export const openAlexAdapter: ProviderAdapter = async (request, context) => {
  if (!validContext(context)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') }
  if (!validRequest(request) || request.language !== undefined || request.region !== undefined || request.safeSearch !== undefined || request.timeRange !== undefined) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }

  const url = new URL(ENDPOINT)
  url.searchParams.set('search', request.query)
  url.searchParams.set('per-page', String(request.limit))
  url.searchParams.set('api_key', context.credentials.api_key)
  if (request.page !== undefined) url.searchParams.set('page', String(request.page))

  let response: Response
  try {
    response = await (context.fetch ?? fetch)(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: context.signal, redirect: 'manual' })
  } catch { return { ok: false, failure: fetchFailure(PROVIDER_ID, context.signal) } }

  const failed = responseFailure(PROVIDER_ID, response)
  if (failed) { await cancelResponseBody(response); return { ok: false, failure: failed } }
  try { return normalize(await readBoundedJson(response), request.limit, request.page ?? 1) }
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
    && (request.page === undefined || (Number.isInteger(request.page) && request.page >= 1 && request.page <= Math.ceil(MAX_RESULTS / request.limit)))
}

function normalize(payload: unknown, limit: number, page: number): ProviderAdapterOutcome {
  if (!isPlainRecord(payload) || !Array.isArray(payload.results)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  const results: NormalizedSearchResult[] = []
  for (const [index, value] of payload.results.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
    if (!isPlainRecord(value)) continue
    const title = boundedText(value.display_name, PROVIDER_ADAPTER_LIMITS.titleCharacters)
    const target = locationUrl(value) ?? normalizedUrl(value.doi)
    if (!title || !target) continue
    results.push(clean({
      providerId: PROVIDER_ID,
      providerRank: (page - 1) * limit + index + 1,
      title,
      ...target,
      snippet: abstract(value.abstract_inverted_index),
      publishedAt: normalizedDate(value.publication_date),
      author: author(value.authorships),
      contentType: boundedText(value.type, PROVIDER_ADAPTER_LIMITS.contentTypeCharacters),
      providerScore: finiteNumber(value.relevance_score),
    }))
  }
  return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) }
}

function locationUrl(value: Record<string, unknown>) {
  for (const key of ['primary_location', 'best_oa_location']) {
    const location = value[key]
    const target = isPlainRecord(location) ? normalizedUrl(location.landing_page_url) : undefined
    if (target) return target
  }
}

function abstract(value: unknown): string | undefined {
  if (!isPlainRecord(value)) return
  const words: Array<[number, string]> = []
  for (const [fragment, positions] of Object.entries(value)) {
    const word = boundedText(fragment, 100)
    if (!word || !Array.isArray(positions)) continue
    for (const position of positions) {
      if (words.length >= PROVIDER_ADAPTER_LIMITS.snippetCharacters) break
      if (Number.isInteger(position) && position >= 0) words.push([position, word])
    }
    if (words.length >= PROVIDER_ADAPTER_LIMITS.snippetCharacters) break
  }
  return boundedText(words.sort(([left], [right]) => left - right).map(([, word]) => word).join(' '), PROVIDER_ADAPTER_LIMITS.snippetCharacters)
}

function author(value: unknown): string | undefined {
  if (!Array.isArray(value) || !isPlainRecord(value[0]) || !isPlainRecord(value[0].author)) return
  return boundedText(value[0].author.display_name, PROVIDER_ADAPTER_LIMITS.authorCharacters)
}

function validCredential(value: unknown): value is string { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes }
function clean<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
