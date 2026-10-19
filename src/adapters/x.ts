import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'x'
const ENDPOINT = 'https://api.x.com/2/tweets/search/all'

export const xAdapter: ProviderAdapter = async (request, context) => {
  if (!validContext(context)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') }
  if (!validRequest(request) || request.page !== undefined || request.language !== undefined || request.region !== undefined || request.safeSearch !== undefined || request.timeRange !== undefined) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }
  const url = new URL(ENDPOINT)
  url.searchParams.set('query', request.query)
  url.searchParams.set('max_results', String(Math.max(10, request.limit)))
  url.searchParams.set('tweet.fields', 'created_at,author_id,text')
  let response: Response
  try { response = await (context.fetch ?? fetch)(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${context.credentials.api_key}` }, signal: context.signal, redirect: 'manual' }) }
  catch { return { ok: false, failure: fetchFailure(PROVIDER_ID, context.signal) } }
  const failed = responseFailure(PROVIDER_ID, response)
  if (failed) { await cancelResponseBody(response); return { ok: false, failure: failed } }
  try { return normalize(await readBoundedJson(response), request.limit) }
  catch (error) { return { ok: false, failure: error instanceof InvalidProviderResponse ? providerFailure(PROVIDER_ID, 'provider_invalid_response') : fetchFailure(PROVIDER_ID, context.signal) } }
}

function validContext(context: ProviderAdapterContext): boolean { return Object.keys(context.credentials).length === 1 && validCredential(context.credentials.api_key) }
function validRequest(request: NormalizedSearchRequest): boolean { return request.query === request.query.trim() && request.query.length > 0 && request.query.length <= PROVIDER_ADAPTER_LIMITS.queryCharacters && request.query.split(/\s+/).length <= PROVIDER_ADAPTER_LIMITS.queryWords && Number.isInteger(request.limit) && request.limit >= 1 && request.limit <= PROVIDER_ADAPTER_LIMITS.results }
function normalize(payload: unknown, limit: number): ProviderAdapterOutcome {
  if (!isPlainRecord(payload)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  if (payload.data === undefined && isPlainRecord(payload.meta) && payload.meta.result_count === 0) return { ok: true, providerId: PROVIDER_ID, results: [] }
  if (!Array.isArray(payload.data)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  const results: NormalizedSearchResult[] = []
  for (const [index, value] of payload.data.slice(0, limit).entries()) {
    if (!isPlainRecord(value)) continue
    const id = boundedText(value.id, 20)
    const text = boundedText(value.text, PROVIDER_ADAPTER_LIMITS.snippetCharacters)
    if (!id || !/^\d+$/.test(id) || !text) continue
    const target = normalizedUrl(`https://x.com/i/web/status/${id}`)
    if (!target) continue
    const authorId = boundedText(value.author_id, 20)
    results.push({ providerId: PROVIDER_ID, providerRank: index + 1, title: text.slice(0, PROVIDER_ADAPTER_LIMITS.titleCharacters), ...target, snippet: text, publishedAt: normalizedDate(value.created_at), contentType: 'post', metadata: { id, ...(authorId && /^\d+$/.test(authorId) ? { authorId } : {}) } })
  }
  return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) }
}
function validCredential(value: unknown): value is string { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes }
