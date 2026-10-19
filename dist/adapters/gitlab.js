import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js';
import { PROVIDER_ADAPTER_LIMITS } from '../types.js';
const PROVIDER_ID = 'gitlab';
const ENDPOINT = 'https://gitlab.com/api/v4/projects';
const TIME_RANGE_DAYS = { day: 1, week: 7, month: 30, year: 365 };
export const gitlabAdapter = async (request, context) => {
    if (!validContext(context))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') };
    if (!validRequest(request) || unsupportedOption(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    const url = new URL(ENDPOINT);
    url.searchParams.set('search', request.query);
    url.searchParams.set('visibility', 'public');
    url.searchParams.set('per_page', String(request.limit));
    if (request.timeRange)
        url.searchParams.set('last_activity_after', new Date(Date.now() - TIME_RANGE_DAYS[request.timeRange] * 86_400_000).toISOString());
    let response;
    try {
        response = await (context.fetch ?? fetch)(url, {
            method: 'GET', headers: clean({ Accept: 'application/json', 'PRIVATE-TOKEN': context.credentials.api_key }), signal: context.signal, redirect: 'manual',
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
    const keys = Object.keys(context.credentials);
    return keys.length === 0 || (keys.length === 1 && keys[0] === 'api_key' && validCredential(context.credentials.api_key));
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
    return request.language !== undefined
        || request.region !== undefined
        || request.safeSearch !== undefined
        || (request.timeRange !== undefined && !['day', 'week', 'month', 'year'].includes(request.timeRange));
}
function normalize(payload, limit) {
    if (!Array.isArray(payload))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') };
    const results = [];
    for (const [index, value] of payload.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
        if (!isPlainRecord(value))
            continue;
        const title = boundedText(value.name_with_namespace, PROVIDER_ADAPTER_LIMITS.titleCharacters);
        const target = normalizedUrl(value.web_url);
        if (!title || !target)
            continue;
        results.push(clean({
            providerId: PROVIDER_ID,
            providerRank: index + 1,
            title,
            ...target,
            snippet: boundedText(value.description, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
            publishedAt: normalizedDate(value.last_activity_at),
            metadata: metadata(value),
        }));
    }
    return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) };
}
function metadata(value) {
    const values = [
        ['name', boundedText(value.name, PROVIDER_ADAPTER_LIMITS.titleCharacters)],
        ['namespace', isPlainRecord(value.namespace) ? boundedText(value.namespace.full_path, PROVIDER_ADAPTER_LIMITS.titleCharacters) : undefined],
        ['star_count', validCount(value.star_count)],
        ['forks_count', validCount(value.forks_count)],
        ['topics', topics(value.topics)],
        ['readme_url', normalizedUrl(value.readme_url)?.url],
    ];
    const result = {};
    for (const [key, item] of values) {
        if (item === undefined || Object.keys(result).length >= PROVIDER_ADAPTER_LIMITS.metadataEntries)
            continue;
        const candidate = { ...result, [key]: item };
        if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength <= PROVIDER_ADAPTER_LIMITS.metadataBytes)
            result[key] = item;
    }
    return Object.keys(result).length ? result : undefined;
}
function topics(value) {
    if (!Array.isArray(value))
        return;
    return boundedText(value.slice(0, PROVIDER_ADAPTER_LIMITS.metadataEntries).filter((item) => typeof item === 'string').join(', '), PROVIDER_ADAPTER_LIMITS.metadataBytes);
}
function validCount(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
function validCredential(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes; }
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
