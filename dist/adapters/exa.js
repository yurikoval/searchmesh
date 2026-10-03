import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js';
import { PROVIDER_ADAPTER_LIMITS } from '../types.js';
const PROVIDER_ID = 'exa';
const ENDPOINT = 'https://api.exa.ai/search';
export const exaAdapter = async (request, context) => {
    if (!validContext(context))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') };
    if (!validRequest(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    if (request.language !== undefined || request.region !== undefined || request.safeSearch !== undefined || request.timeRange !== undefined)
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    let response;
    try {
        response = await (context.fetch ?? fetch)(ENDPOINT, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-api-key': context.credentials.api_key },
            body: JSON.stringify({ query: request.query, numResults: request.limit, type: 'auto', contents: { text: { maxCharacters: PROVIDER_ADAPTER_LIMITS.snippetCharacters } } }),
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
        const image = normalizedUrl(value.image);
        results.push(clean({
            providerId: PROVIDER_ID,
            providerRank: index + 1,
            title,
            ...target,
            snippet: boundedText(value.text, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
            publishedAt: normalizedDate(value.publishedDate),
            author: boundedText(value.author, PROVIDER_ADAPTER_LIMITS.authorCharacters),
            imageUrl: image?.url,
        }));
    }
    return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) };
}
function validCredential(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes; }
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
