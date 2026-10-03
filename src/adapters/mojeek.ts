import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, finiteNumber, InvalidProviderResponse, isPlainRecord, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'mojeek'
const ENDPOINT = 'https://api.mojeek.com/search'

export const mojeekAdapter: ProviderAdapter = async (request, context) => {
  if (!validContext(context)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') }
  if (!validRequest(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }
  if (unsupportedOption(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }

  const url = new URL(ENDPOINT)
  url.searchParams.set('q', request.query)
  url.searchParams.set('t', String(request.limit))
  url.searchParams.set('fmt', 'json')
  if (request.language) url.searchParams.set('lb', request.language)
  if (request.region) url.searchParams.set('rb', request.region)
  url.searchParams.set('api_key', context.credentials.api_key)

  let response: Response
  try {
    response = await (context.fetch ?? fetch)(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: context.signal, redirect: 'error' })
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
    || request.timeRange !== undefined
}

function normalize(payload: unknown, limit: number): ProviderAdapterOutcome {
  if (!isPlainRecord(payload) || !isPlainRecord(payload.response)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  if (typeof payload.response.status !== 'string') return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  if (payload.response.status !== 'OK') return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_error') }
  if (!Array.isArray(payload.response.results)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }

  const results: NormalizedSearchResult[] = []
  for (const [index, value] of payload.response.results.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
    if (!isPlainRecord(value)) continue
    const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters)
    const target = normalizedUrl(value.url)
    if (!title || !target) continue
    const image = normalizedUrl(value.image)
    results.push(clean({
      providerId: PROVIDER_ID,
      providerRank: index + 1,
      title,
      ...target,
      snippet: boundedText(value.desc, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
      imageUrl: image?.url,
      providerScore: finiteNumber(value.score),
    }))
  }
  return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) }
}

function validCredential(value: unknown): value is string { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes }
function clean<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
