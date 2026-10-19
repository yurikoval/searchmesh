import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, finiteNumber, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, parseRetryAfter, providerFailure, readBoundedJson, responseFailure } from '../normalize.js';
import { PROVIDER_ADAPTER_LIMITS } from '../types.js';
const PROVIDER_ID = 'github';
const ENDPOINT = 'https://api.github.com/search/repositories';
const SEARCH_SCOPE = 'in:name,description,readme is:public';
const QUERY_CHARACTERS = 256;
const encoder = new TextEncoder();
export const githubAdapter = async (request, context) => {
    if (!validContext(context))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_configuration_error') };
    if (!validRequest(request) || unsupportedOption(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    const url = new URL(ENDPOINT);
    url.searchParams.set('q', `${request.query} ${SEARCH_SCOPE}`);
    url.searchParams.set('per_page', String(request.limit));
    if (request.page !== undefined)
        url.searchParams.set('page', String(request.page));
    let response;
    try {
        response = await (context.fetch ?? fetch)(url, {
            method: 'GET',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${context.credentials.api_key}`,
                'X-GitHub-Api-Version': '2022-11-28',
            },
            signal: context.signal,
            redirect: 'manual',
        });
    }
    catch {
        return { ok: false, failure: fetchFailure(PROVIDER_ID, context.signal) };
    }
    const failed = githubResponseFailure(response);
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
        && request.query.length <= Math.min(QUERY_CHARACTERS, PROVIDER_ADAPTER_LIMITS.queryCharacters)
        && request.query.split(/\s+/).length <= PROVIDER_ADAPTER_LIMITS.queryWords
        && (request.query.match(/\b(?:AND|OR|NOT)\b/g)?.length ?? 0) <= 5
        && Number.isInteger(request.limit)
        && request.limit >= 1
        && request.limit <= PROVIDER_ADAPTER_LIMITS.results
        && (request.page === undefined || (Number.isInteger(request.page) && request.page >= 1 && request.page <= Math.ceil(1_000 / request.limit)));
}
function unsupportedOption(request) {
    return request.language !== undefined || request.region !== undefined || request.safeSearch !== undefined || request.timeRange !== undefined;
}
function githubResponseFailure(response, now = Date.now()) {
    if (response.status === 403 || response.status === 429) {
        return providerFailure(PROVIDER_ID, 'provider_rate_limited', { httpStatus: response.status, retryAfterMs: retryAfter(response, now) });
    }
    return responseFailure(PROVIDER_ID, response, now);
}
function retryAfter(response, now) {
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'), now);
    if (retryAfterMs !== undefined)
        return retryAfterMs;
    const reset = response.headers.get('X-RateLimit-Reset');
    if (!reset || !/^\d+$/.test(reset))
        return;
    const milliseconds = Number(reset) * 1_000 - now;
    return Number.isFinite(milliseconds) && milliseconds >= 0 ? milliseconds : undefined;
}
function normalize(payload, limit, page) {
    if (!isPlainRecord(payload) || !Array.isArray(payload.items))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') };
    const results = [];
    const firstRank = (page - 1) * limit + 1;
    const resultLimit = Math.min(limit, PROVIDER_ADAPTER_LIMITS.results, 1_001 - firstRank);
    for (const [index, value] of payload.items.slice(0, resultLimit).entries()) {
        if (!isPlainRecord(value))
            continue;
        const name = boundedText(value.name, 100);
        const fullName = boundedText(value.full_name, PROVIDER_ADAPTER_LIMITS.titleCharacters);
        const target = normalizedUrl(value.html_url);
        if (!name || !fullName || !target || value.private !== false || value.visibility !== 'public' || target.domain !== 'github.com' || !target.url.startsWith('https://github.com/'))
            continue;
        const topics = Array.isArray(value.topics)
            ? value.topics.slice(0, 20).flatMap((topic) => boundedText(topic, 50) ?? []).join(', ').slice(0, 1_000)
            : undefined;
        results.push(clean({
            providerId: PROVIDER_ID,
            providerRank: firstRank + index,
            title: fullName,
            ...target,
            snippet: boundedText(value.description, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
            contentType: 'repository',
            providerScore: finiteNumber(value.score),
            metadata: cleanMetadata({
                name,
                fullName,
                stars: nonNegativeInteger(value.stargazers_count),
                language: boundedText(value.language, 100),
                topics,
                updatedAt: normalizedDate(value.updated_at),
            }),
        }));
    }
    return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) };
}
function nonNegativeInteger(value) { return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined; }
function cleanMetadata(value) {
    const metadata = {};
    for (const [key, item] of Object.entries(value)) {
        if (Object.keys(metadata).length >= PROVIDER_ADAPTER_LIMITS.metadataEntries)
            break;
        if (item !== null && !['string', 'number', 'boolean'].includes(typeof item))
            continue;
        const candidate = { ...metadata, [key]: item };
        if (encoder.encode(JSON.stringify(candidate)).byteLength <= PROVIDER_ADAPTER_LIMITS.metadataBytes)
            Object.assign(metadata, { [key]: item });
    }
    return metadata;
}
function validCredential(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes; }
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
