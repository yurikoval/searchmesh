import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, finiteNumber, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js';
import { PROVIDER_ADAPTER_LIMITS } from '../types.js';
const PROVIDER_ID = 'openalex';
const ENDPOINT = 'https://api.openalex.org/works';
const MAX_RESULTS = 10_000;
export const openAlexAdapter = async (request, context) => {
    if (!validContext(context))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') };
    if (!validRequest(request) || request.language !== undefined || request.region !== undefined || request.safeSearch !== undefined || request.timeRange !== undefined)
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    const url = new URL(ENDPOINT);
    url.searchParams.set('search', request.query);
    url.searchParams.set('per-page', String(request.limit));
    url.searchParams.set('api_key', context.credentials.api_key);
    if (request.page !== undefined)
        url.searchParams.set('page', String(request.page));
    let response;
    try {
        response = await (context.fetch ?? fetch)(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: context.signal, redirect: 'manual' });
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
        return normalize(await readBoundedJson(response), request.limit, request.page ?? 1);
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
        && request.limit <= PROVIDER_ADAPTER_LIMITS.results
        && (request.page === undefined || (Number.isInteger(request.page) && request.page >= 1 && request.page <= Math.ceil(MAX_RESULTS / request.limit)));
}
function normalize(payload, limit, page) {
    if (!isPlainRecord(payload) || !Array.isArray(payload.results))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') };
    const results = [];
    for (const [index, value] of payload.results.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
        if (!isPlainRecord(value))
            continue;
        const title = boundedText(value.display_name, PROVIDER_ADAPTER_LIMITS.titleCharacters);
        const target = locationUrl(value) ?? normalizedUrl(value.doi);
        if (!title || !target)
            continue;
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
        }));
    }
    return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) };
}
function locationUrl(value) {
    for (const key of ['primary_location', 'best_oa_location']) {
        const location = value[key];
        const target = isPlainRecord(location) ? normalizedUrl(location.landing_page_url) : undefined;
        if (target)
            return target;
    }
}
function abstract(value) {
    if (!isPlainRecord(value))
        return;
    const words = [];
    for (const [fragment, positions] of Object.entries(value)) {
        const word = boundedText(fragment, 100);
        if (!word || !Array.isArray(positions))
            continue;
        for (const position of positions) {
            if (words.length >= PROVIDER_ADAPTER_LIMITS.snippetCharacters)
                break;
            if (Number.isInteger(position) && position >= 0)
                words.push([position, word]);
        }
        if (words.length >= PROVIDER_ADAPTER_LIMITS.snippetCharacters)
            break;
    }
    return boundedText(words.sort(([left], [right]) => left - right).map(([, word]) => word).join(' '), PROVIDER_ADAPTER_LIMITS.snippetCharacters);
}
function author(value) {
    if (!Array.isArray(value) || !isPlainRecord(value[0]) || !isPlainRecord(value[0].author))
        return;
    return boundedText(value[0].author.display_name, PROVIDER_ADAPTER_LIMITS.authorCharacters);
}
function validCredential(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes; }
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
