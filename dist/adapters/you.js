import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js';
import { PROVIDER_ADAPTER_LIMITS } from '../types.js';
const PROVIDER_ID = 'you';
const ENDPOINT = 'https://ydc-index.io/v1/search';
const LANGUAGES = new Set(['ar', 'eu', 'bn', 'bg', 'ca', 'zh-hans', 'zh-hant', 'hr', 'cs', 'da', 'nl', 'en', 'en-gb', 'et', 'fi', 'fr', 'gl', 'de', 'el', 'gu', 'he', 'hi', 'hu', 'is', 'it', 'ja', 'kn', 'ko', 'lv', 'lt', 'ms', 'ml', 'mr', 'nb', 'pl', 'pt-br', 'pt-pt', 'pa', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sv', 'ta', 'te', 'th', 'tr', 'uk', 'vi']);
const REGIONS = new Set(['AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CL', 'DK', 'FI', 'FR', 'DE', 'HK', 'IN', 'ID', 'IT', 'JP', 'KR', 'MY', 'MX', 'NL', 'NZ', 'NO', 'CN', 'PL', 'PT', 'PH', 'RU', 'SA', 'ZA', 'ES', 'SE', 'CH', 'TW', 'TR', 'GB', 'US']);
const TIME_RANGE = { day: 'day', week: 'week', month: 'month', year: 'year' };
export const youAdapter = async (request, context) => {
    if (!validContext(context))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') };
    if (!validRequest(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    if (unsupportedOption(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    let response;
    try {
        response = await (context.fetch ?? fetch)(ENDPOINT, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-API-Key': context.credentials.api_key },
            body: JSON.stringify(clean({
                query: request.query,
                count: request.limit,
                language: request.language?.toUpperCase(),
                country: request.region,
                safesearch: request.safeSearch,
                freshness: request.timeRange && TIME_RANGE[request.timeRange],
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
    return (request.language !== undefined && !LANGUAGES.has(request.language))
        || (request.region !== undefined && !REGIONS.has(request.region))
        || (request.safeSearch !== undefined && !['off', 'moderate', 'strict'].includes(request.safeSearch))
        || (request.timeRange !== undefined && !Object.hasOwn(TIME_RANGE, request.timeRange));
}
function normalize(payload, limit) {
    if (!isPlainRecord(payload) || !isPlainRecord(payload.results) || !Array.isArray(payload.results.web))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') };
    const results = [];
    for (const [index, value] of payload.results.web.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
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
            snippet: boundedText(value.description, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
            publishedAt: normalizedDate(value.page_age),
            imageUrl: normalizedUrl(value.thumbnail_url)?.url,
        }));
    }
    return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) };
}
function validCredential(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes; }
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
