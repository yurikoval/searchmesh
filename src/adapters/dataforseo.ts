import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js'
import { getAdapterPolicy } from '../url-policy.js'
import { PROVIDER_ADAPTER_LIMITS, type NormalizedSearchRequest, type NormalizedSearchResult, type ProviderAdapter, type ProviderAdapterContext, type ProviderAdapterOutcome } from '../types.js'

const PROVIDER_ID = 'dataforseo'
const ENDPOINT = 'https://api.dataforseo.com/v3/serp/google/organic/live/advanced'
// v1 has no region/device inputs, so searches use DataForSEO's US desktop market.
const DEFAULT_LOCATION_CODE = 2840
const DEFAULT_DEVICE = 'desktop'

export const dataForSeoAdapter: ProviderAdapter = async (request, context) => {
  const configured = validContext(context)
  if (!configured || !validRequest(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, configured ? 'provider_unsupported_parameter' : 'provider_configuration_error') }
  if (unsupportedOption(request)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') }

  let response: Response
  try {
    response = await (context.fetch ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${btoa(`${context.credentials.login}:${context.credentials.password}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{ keyword: request.query, location_code: DEFAULT_LOCATION_CODE, language_code: request.language ?? 'en', device: DEFAULT_DEVICE, depth: request.limit }]),
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
    && sameValues(definition.capabilities.optional_inputs, ['language'])
    && Object.keys(definition.request_mapping.query).length === 0
    && sameKeys(definition.request_mapping.body, ['query', 'language'])
    && definition.request_mapping.body.query === 'keyword'
    && definition.request_mapping.body.language === 'language_code'
    && definition.authentication.fields.length === 2
    && definition.authentication.fields[0].name === 'login'
    && definition.authentication.fields[1].name === 'password'
    && Object.keys(context.credentials).length === 2
    && validCredential(context.credentials.login, false)
    && validCredential(context.credentials.password, true)
    && samePath(definition.response_mapping.results, ['tasks', 0, 'result', 0, 'items'])
    && samePath(definition.response_mapping.title, ['title'])
    && samePath(definition.response_mapping.url, ['url'])
    && samePath(definition.response_mapping.snippet, ['description'])
    && samePath(definition.response_mapping.rank, ['rank_group'])
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
    || request.region !== undefined
    || request.safeSearch !== undefined
    || request.timeRange !== undefined
}

function normalize(payload: unknown, limit: number): ProviderAdapterOutcome {
  if (!isPlainRecord(payload)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  if (payload.status_code !== 20000) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_error') }
  if (!Array.isArray(payload.tasks) || payload.tasks.length !== 1 || !isPlainRecord(payload.tasks[0])) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }
  const task = payload.tasks[0]
  if (task.status_code !== 20000) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_error') }
  if (!Array.isArray(task.result) || !isPlainRecord(task.result[0]) || !Array.isArray(task.result[0].items)) return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') }

  const results: NormalizedSearchResult[] = []
  for (const [index, value] of task.result[0].items.entries()) {
    if (results.length >= limit || !isPlainRecord(value) || value.type !== 'organic') continue
    const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters)
    const target = normalizedUrl(value.url)
    if (!title || !target) continue
    results.push(clean({
      providerId: PROVIDER_ID,
      providerRank: validRank(value.rank_group) ?? index + 1,
      title,
      ...target,
      snippet: boundedText(value.description, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
    }))
  }
  return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) }
}

function validRank(value: unknown): number | undefined { return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= PROVIDER_ADAPTER_LIMITS.results ? value as number : undefined }
function validCredential(value: unknown, allowColon: boolean): value is string { return typeof value === 'string' && value === value.trim() && value.length > 0 && (allowColon || !value.includes(':')) && /^[\x20-\x7e]+$/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes }
function samePath(actual: readonly (string | number)[] | undefined, expected: readonly (string | number)[]): boolean { return Boolean(actual) && actual!.length === expected.length && actual!.every((value, index) => value === expected[index]) }
function sameKeys(value: object, expected: readonly string[]): boolean { const keys = Object.keys(value); return keys.length === expected.length && expected.every((key) => keys.includes(key)) }
function sameValues(actual: readonly string[], expected: readonly string[]): boolean { return actual.length === expected.length && expected.every((value) => actual.includes(value)) }
function clean<T extends Record<string, unknown>>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T }
