import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { getAdapterPolicy } from '../url-policy.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'serpapi'
const ENDPOINT = 'https://serpapi.com/search'
const TIME_RANGE = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' } as const

export const serpApiAdapter: ProviderAdapter = async (request, context) => {
  const configured = validContext(context)
  if (!configured || !validRequest(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, configured ? 'provider_unsupported_parameter' : 'provider_configuration_error') }
  if (unsupportedOption(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }

  const url = new URL(ENDPOINT)
  url.searchParams.set('engine', 'google')
  url.searchParams.set('q', request.query)
  url.searchParams.set('num', String(request.limit))
  if (request.language) url.searchParams.set('hl', request.language)
  if (request.region) url.searchParams.set('gl', request.region.toLowerCase())
  if (request.timeRange) url.searchParams.set('tbs', TIME_RANGE[request.timeRange])
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
    && definition.capabilities.operations.length === 1
    && definition.capabilities.operations[0] === 'search'
    && sameValues(definition.capabilities.optional_inputs, ['language', 'region', 'time_range'])
    && sameKeys(definition.request_mapping.query, ['query', 'language', 'region', 'time_range'])
    && definition.request_mapping.query.query === 'q'
    && definition.request_mapping.query.language === 'hl'
    && definition.request_mapping.query.region === 'gl'
    && definition.request_mapping.query.time_range === 'tbs'
    && Object.keys(definition.request_mapping.body).length === 0
    && definition.authentication.fields.length === 1
    && definition.authentication.fields[0].name === 'api_key'
    && Object.keys(context.credentials).length === 1
    && validCredential(context.credentials.api_key)
    && samePath(definition.response_mapping.results, ['organic_results'])
    && samePath(definition.response_mapping.title, ['title'])
    && samePath(definition.response_mapping.url, ['link'])
    && samePath(definition.response_mapping.snippet, ['snippet'])
    && samePath(definition.response_mapping.rank, ['position'])
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
  return (request.language !== undefined && !/^(?:[a-z]{2}|zh-(?:cn|tw))$/.test(request.language))
    || (request.region !== undefined && !/^[A-Z]{2}$/.test(request.region))
    || request.safeSearch !== undefined
    || (request.timeRange !== undefined && !Object.hasOwn(TIME_RANGE, request.timeRange))
}

function normalize(payload: unknown, limit: number): ProviderAdapterOutcome {
  if (!isPlainRecord(payload)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  if (payload.error !== undefined) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_error') }
  if (payload.search_metadata !== undefined) {
    if (!isPlainRecord(payload.search_metadata) || payload.search_metadata.status !== 'Success') return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_error') }
  }
  if (!Array.isArray(payload.organic_results)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }

  const results: NormalizedSearchResult[] = []
  for (const [index, value] of payload.organic_results.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
    if (!isPlainRecord(value)) continue
    const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters)
    const target = normalizedUrl(value.link)
    if (!title || !target) continue
    results.push(clean({
      providerId: PROVIDER_ID,
      providerRank: validRank(value.position) ?? index + 1,
      title,
      ...target,
      displayUrl: boundedText(value.displayed_link, PROVIDER_ADAPTER_LIMITS.displayUrlCharacters),
      snippet: boundedText(value.snippet, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
    }))
  }
  return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) }
}

function validRank(value: unknown): number | undefined { return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= PROVIDER_ADAPTER_LIMITS.results ? value as number : undefined }
function validCredential(value: unknown): value is string { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes }
function samePath(actual: readonly (string | number)[] | undefined, expected: readonly (string | number)[]): boolean { return Boolean(actual) && actual!.length === expected.length && actual!.every((value, index) => value === expected[index]) }
function sameKeys(value: object, expected: readonly string[]): boolean { const keys = Object.keys(value); return keys.length === expected.length && expected.every((key) => keys.includes(key)) }
function sameValues(actual: readonly string[], expected: readonly string[]): boolean { return actual.length === expected.length && expected.every((value) => actual.includes(value)) }
function clean<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
