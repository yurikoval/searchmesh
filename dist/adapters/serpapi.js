import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js';
import { PROVIDER_ADAPTER_LIMITS } from '../types.js';
const PROVIDER_ID = 'serpapi';
const ENDPOINT = 'https://serpapi.com/search';
const TIME_RANGE = { day: 'qdr:d', week: 'qdr:w', month: 'qdr:m', year: 'qdr:y' };
export const serpApiAdapter = async (request, context) => {
    if (!validContext(context))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') };
    if (!validRequest(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    if (unsupportedOption(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    const url = new URL(ENDPOINT);
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', request.query);
    url.searchParams.set('num', String(request.limit));
    if (request.language)
        url.searchParams.set('hl', request.language);
    if (request.region)
        url.searchParams.set('gl', request.region.toLowerCase());
    if (request.timeRange)
        url.searchParams.set('tbs', TIME_RANGE[request.timeRange]);
    url.searchParams.set('api_key', context.credentials.api_key);
    let response;
    try {
        response = await (context.fetch ?? fetch)(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: context.signal, redirect: 'error' });
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
    return Object.keys(context.credentials).length === 1 && validCredential(context.credentials.api_key);
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
function unsupportedOption(request) {
    return (request.language !== undefined && !/^(?:[a-z]{2}|zh-(?:cn|tw))$/.test(request.language))
        || (request.region !== undefined && !/^[A-Z]{2}$/.test(request.region))
        || request.safeSearch !== undefined
        || (request.timeRange !== undefined && !Object.hasOwn(TIME_RANGE, request.timeRange));
}
function normalize(payload, limit) {
    if (!isPlainRecord(payload))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') };
    if (payload.error !== undefined)
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_error') };
    if (payload.search_metadata !== undefined) {
        if (!isPlainRecord(payload.search_metadata) || payload.search_metadata.status !== 'Success')
            return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_error') };
    }
    if (!Array.isArray(payload.organic_results))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') };
    const results = [];
    for (const [index, value] of payload.organic_results.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
        if (!isPlainRecord(value))
            continue;
        const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters);
        const target = normalizedUrl(value.link);
        if (!title || !target)
            continue;
        results.push(clean({
            providerId: PROVIDER_ID,
            providerRank: validRank(value.position) ?? index + 1,
            title,
            ...target,
            displayUrl: boundedText(value.displayed_link, PROVIDER_ADAPTER_LIMITS.displayUrlCharacters),
            snippet: boundedText(value.snippet, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
        }));
    }
    return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) };
}
function validRank(value) { return Number.isSafeInteger(value) && value >= 1 && value <= PROVIDER_ADAPTER_LIMITS.results ? value : undefined; }
function validCredential(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes; }
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
