import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js';
import { getAdapterPolicy } from '../url-policy.js';
import { PROVIDER_ADAPTER_LIMITS } from '../types.js';
const PROVIDER_ID = 'perplexity';
const ENDPOINT = 'https://api.perplexity.ai/search';
const TIME_RANGE = { day: 'day', week: 'week', month: 'month', year: 'year' };
export const perplexityAdapter = async (request, context) => {
    const configured = validContext(context);
    if (!configured || !validRequest(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, configured ? 'provider_unsupported_parameter' : 'provider_configuration_error') };
    if (unsupportedOption(request, context))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    let response;
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
        });
    }
    catch {
        return { ok: false, failure: fetchFailure(PROVIDER_ID, context.signal) };
    }
    const failed = responseFailure(PROVIDER_ID, response);
    if (failed) {
        await cancelResponseBody(response);
        return { ok: false, failure: failed };
    }
    try {
        return normalize(await readBoundedJson(response), request.limit);
    }
    catch (error) {
        return { ok: false, failure: error instanceof InvalidProviderResponse ? providerFailure(PROVIDER_ID, 'provider_invalid_response') : fetchFailure(PROVIDER_ID, context.signal) };
    }
};
function validContext(context) {
    const { definition } = context;
    const policy = getAdapterPolicy(PROVIDER_ID);
    return Boolean(policy)
        && context.providerId === PROVIDER_ID
        && definition.id === PROVIDER_ID
        && definition.adapter === PROVIDER_ID
        && definition.available
        && definition.status !== 'retired'
        && definition.endpoint.api_base_url === `${policy.origin}${policy.basePath}`
        && definition.endpoint.path === policy.path
        && definition.endpoint.method === policy.method
        && sameValues(definition.capabilities.operations, ['search'])
        && sameValues(definition.capabilities.optional_inputs, ['language', 'region', 'time_range'])
        && Object.keys(definition.request_mapping.query).length === 0
        && sameKeys(definition.request_mapping.body, ['query', 'language', 'region', 'time_range'])
        && definition.request_mapping.body.query === 'query'
        && definition.request_mapping.body.language === 'search_language_filter'
        && definition.request_mapping.body.region === 'country'
        && definition.request_mapping.body.time_range === 'search_recency_filter'
        && definition.authentication.fields.length === 1
        && definition.authentication.fields[0].name === 'api_key'
        && Object.keys(context.credentials).length === 1
        && validCredential(context.credentials.api_key)
        && samePath(definition.response_mapping.results, ['results'])
        && samePath(definition.response_mapping.title, ['title'])
        && samePath(definition.response_mapping.url, ['url'])
        && samePath(definition.response_mapping.snippet, ['snippet'])
        && definition.response_mapping.rank === undefined;
}
function validRequest(request) {
    return request.query === request.query.trim()
        && request.query.length > 0
        && request.query.length <= PROVIDER_ADAPTER_LIMITS.queryCharacters
        && request.query.split(/\s+/).length <= PROVIDER_ADAPTER_LIMITS.queryWords
        && Number.isInteger(request.limit)
        && request.limit >= 1
        && request.limit <= PROVIDER_ADAPTER_LIMITS.results;
}
function unsupportedOption(request, context) {
    const supported = new Set(context.definition.capabilities.optional_inputs);
    return (request.language !== undefined && (!supported.has('language') || !/^[a-z]{2}$/.test(request.language)))
        || (request.region !== undefined && (!supported.has('region') || !/^[A-Z]{2}$/.test(request.region)))
        || request.safeSearch !== undefined
        || (request.timeRange !== undefined && (!supported.has('time_range') || !Object.hasOwn(TIME_RANGE, request.timeRange)));
}
function normalize(payload, limit) {
    if (!isPlainRecord(payload) || !Array.isArray(payload.results))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') };
    const results = [];
    for (const [index, value] of payload.results.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
        if (!isPlainRecord(value))
            continue;
        const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters);
        const target = normalizedUrl(value.url);
        if (!title || !target)
            continue;
        results.push(clean({
            providerId: PROVIDER_ID,
            providerRank: index + 1,
            title,
            ...target,
            snippet: boundedText(value.snippet, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
            publishedAt: normalizedDate(value.date),
        }));
    }
    return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) };
}
function validCredential(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes; }
function samePath(actual, expected) { return Boolean(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]); }
function sameKeys(value, expected) { const keys = Object.keys(value); return keys.length === expected.length && expected.every((key) => keys.includes(key)); }
function sameValues(actual, expected) { return actual.length === expected.length && expected.every((value) => actual.includes(value)); }
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
