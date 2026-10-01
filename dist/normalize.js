import { PROVIDER_ADAPTER_LIMITS } from './types.js';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const FAILURE_POLICY = Object.freeze({
    provider_configuration_error: { message: 'Provider configuration is unavailable.', retryable: false },
    provider_unsupported_parameter: { message: 'Provider does not support the requested parameters.', retryable: false },
    provider_authentication_failed: { message: 'Provider credentials were rejected.', retryable: false },
    provider_rate_limited: { message: 'Provider rate limit reached.', retryable: true },
    provider_rejected_request: { message: 'Provider rejected the request.', retryable: false },
    provider_timeout: { message: 'Provider request timed out.', retryable: true },
    provider_unavailable: { message: 'Provider is temporarily unavailable.', retryable: true },
    provider_invalid_response: { message: 'Provider returned an invalid response.', retryable: false },
    provider_error: { message: 'Provider request failed.', retryable: false },
});
export class InvalidProviderResponse extends Error {
}
export function providerFailure(providerId, code, details = {}) {
    const policy = FAILURE_POLICY[code];
    const httpStatus = Number.isInteger(details.httpStatus) && details.httpStatus >= 100 && details.httpStatus <= 599 ? details.httpStatus : undefined;
    const retryAfterMs = Number.isFinite(details.retryAfterMs) && details.retryAfterMs >= 0 && details.retryAfterMs <= PROVIDER_ADAPTER_LIMITS.retryAfterMs ? Math.floor(details.retryAfterMs) : undefined;
    return clean({ providerId, code, retryable: policy.retryable, message: policy.message, httpStatus, retryAfterMs });
}
export function responseFailure(providerId, response, now = Date.now()) {
    if (response.ok)
        return;
    const details = { httpStatus: response.status };
    if (response.status === 401 || response.status === 403)
        return providerFailure(providerId, 'provider_authentication_failed', details);
    if (response.status === 429)
        return providerFailure(providerId, 'provider_rate_limited', { ...details, retryAfterMs: parseRetryAfter(response.headers.get('Retry-After'), now) });
    if (response.status >= 400 && response.status < 500)
        return providerFailure(providerId, 'provider_rejected_request', details);
    if (response.status >= 500 && response.status < 600)
        return providerFailure(providerId, 'provider_unavailable', details);
    return providerFailure(providerId, 'provider_error', details);
}
export function fetchFailure(providerId, signal) {
    return providerFailure(providerId, signal.aborted ? 'provider_timeout' : 'provider_unavailable');
}
export async function cancelResponseBody(response) {
    try {
        await response.body?.cancel();
    }
    catch { /* no response data is retained */ }
}
export async function readBoundedJson(response) {
    const contentType = response.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
    if (!contentType || (contentType !== 'application/json' && !contentType.endsWith('+json'))) {
        await cancelResponseBody(response);
        throw new InvalidProviderResponse();
    }
    const declared = response.headers.get('Content-Length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > PROVIDER_ADAPTER_LIMITS.responseBytes)) {
        await cancelResponseBody(response);
        throw new InvalidProviderResponse();
    }
    if (!response.body)
        throw new InvalidProviderResponse();
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        total += value.byteLength;
        if (total > PROVIDER_ADAPTER_LIMITS.responseBytes) {
            await reader.cancel();
            throw new InvalidProviderResponse();
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(decoder.decode(bytes));
    }
    catch {
        throw new InvalidProviderResponse();
    }
}
export function isPlainRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
export function boundedText(value, maxCharacters) {
    if (typeof value !== 'string')
        return;
    const text = value.trim();
    if (!text)
        return;
    return text.slice(0, maxCharacters);
}
export function normalizedUrl(value) {
    if (typeof value !== 'string')
        return;
    const text = value.trim();
    if (!text || text.length > PROVIDER_ADAPTER_LIMITS.urlCharacters)
        return;
    try {
        const url = new URL(text);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            return;
        const normalized = url.toString();
        if (normalized.length > PROVIDER_ADAPTER_LIMITS.urlCharacters)
            return;
        return { url: normalized, domain: url.hostname.toLowerCase() };
    }
    catch {
        return;
    }
}
export function normalizedDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
        return;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
export function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
export function boundNormalizedResults(results) {
    const bounded = [];
    for (const result of results.slice(0, PROVIDER_ADAPTER_LIMITS.results)) {
        const next = [...bounded, result];
        if (encoder.encode(JSON.stringify(next)).byteLength > PROVIDER_ADAPTER_LIMITS.normalizedBytes)
            break;
        bounded.push(result);
    }
    return bounded;
}
export function parseRetryAfter(value, now = Date.now()) {
    if (!value)
        return;
    let milliseconds;
    if (/^\d+$/.test(value))
        milliseconds = Number(value) * 1_000;
    else {
        const date = Date.parse(value);
        if (!Number.isFinite(date))
            return;
        milliseconds = Math.max(0, date - now);
    }
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > PROVIDER_ADAPTER_LIMITS.retryAfterMs)
        return;
    return Math.floor(milliseconds);
}
function clean(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}
