import { boundNormalizedResults, boundedText, cancelResponseBody, fetchFailure, InvalidProviderResponse, isPlainRecord, normalizedDate, normalizedUrl, providerFailure, readBoundedJson, responseFailure } from '../normalize.js';
import { getAdapterPolicy } from '../url-policy.js';
import { PROVIDER_ADAPTER_LIMITS } from '../types.js';
const PROVIDER_ID = 'kagi';
const ENDPOINT = 'https://kagi.com/api/v1/search';
export const kagiAdapter = async (request, context) => {
    const configured = validContext(context);
    if (!configured || !validRequest(request))
        return { ok: false, failure: providerFailure(PROVIDER_ID, configured ? 'provider_unsupported_parameter' : 'provider_configuration_error') };
    if (request.language !== undefined || request.region !== undefined || request.safeSearch !== undefined || request.timeRange !== undefined)
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_unsupported_parameter') };
    let response;
    try {
        response = await (context.fetch ?? fetch)(ENDPOINT, {
            method: 'POST',
            headers: { Accept: 'application/json', Authorization: `Bot ${context.credentials.api_key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: request.query, workflow: 'search', limit: request.limit }),
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
    return context.providerId === PROVIDER_ID
        && definition.id === PROVIDER_ID
        && definition.adapter === PROVIDER_ID
        && definition.available
        && definition.status !== 'retired'
        && definition.endpoint.api_base_url === `${policy.origin}${policy.basePath}`
        && definition.endpoint.path === policy.path
        && definition.endpoint.method === policy.method
        && definition.capabilities.operations.length === 1
        && definition.capabilities.operations[0] === 'search'
        && definition.capabilities.optional_inputs.length === 0
        && Object.keys(definition.request_mapping.query).length === 0
        && Object.keys(definition.request_mapping.body).length === 1
        && definition.request_mapping.body.query === 'query'
        && definition.authentication.fields.length === 1
        && definition.authentication.fields[0].name === 'api_key'
        && Object.keys(context.credentials).length === 1
        && validCredential(context.credentials.api_key)
        && samePath(definition.response_mapping.results, ['data', 'search'])
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
function normalize(payload, limit) {
    if (!isPlainRecord(payload) || !isPlainRecord(payload.data) || !Array.isArray(payload.data.search))
        return { ok: false, failure: providerFailure(PROVIDER_ID, 'provider_invalid_response') };
    const results = [];
    for (const [index, value] of payload.data.search.slice(0, Math.min(limit, PROVIDER_ADAPTER_LIMITS.results)).entries()) {
        if (!isPlainRecord(value))
            continue;
        const title = boundedText(value.title, PROVIDER_ADAPTER_LIMITS.titleCharacters);
        const target = normalizedUrl(value.url);
        if (!title || !target)
            continue;
        const image = isPlainRecord(value.image) ? normalizedUrl(value.image.url) : undefined;
        results.push(clean({
            providerId: PROVIDER_ID,
            providerRank: index + 1,
            title,
            ...target,
            snippet: boundedText(value.snippet, PROVIDER_ADAPTER_LIMITS.snippetCharacters),
            publishedAt: normalizedDate(value.time),
            imageUrl: image?.url,
        }));
    }
    return { ok: true, providerId: PROVIDER_ID, results: boundNormalizedResults(results) };
}
function validCredential(value) { return typeof value === 'string' && value === value.trim() && value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value) && new TextEncoder().encode(value).byteLength <= PROVIDER_ADAPTER_LIMITS.credentialBytes; }
function samePath(actual, expected) { return Boolean(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]); }
function clean(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
