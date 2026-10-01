import { getAdapterPolicy, isAllowedAdapterUrl } from './url-policy.js';
export const PROVIDER_LIMITS = Object.freeze({
    sourceBytes: 64 * 1024,
    filesPerRevision: 50,
    revisionBytes: 512 * 1024,
    nodes: 1_000,
    depth: 12,
    mapKeys: 40,
    listItems: 50,
    stringBytes: 4_096,
    definitionBytes: 48 * 1024,
    mappings: 20,
    credentials: 10,
    responsePathSegments: 12,
    exampleBytes: 8 * 1024,
    errors: 20,
    errorReportBytes: 8 * 1024,
});
const TOP_KEYS = ['schema_version', 'id', 'name', 'description', 'website_url', 'documentation_url', 'adapter', 'status', 'available', 'enabled_by_default', 'endpoint', 'capabilities', 'authentication', 'request_mapping', 'response_mapping', 'metadata'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELD = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;
const SECRET_KEY = /(^|[_-])(authorization|cookie|password|secret|token|private[_-]?key|api[_-]?key|env)([_-]|$)/i;
const SECRET_VALUE = /(?:\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh(?:p|o|u|s|r)_[A-Za-z0-9_]{16,}|\bgithub_pat_[A-Za-z0-9_]{16,}|\bsk_live_[A-Za-z0-9]{16,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.)/i;
const PROTOTYPE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const OPTIONAL_INPUTS = new Set(['language', 'region', 'safe_search', 'time_range']);
const SOURCE_FIELDS = new Set(['query', ...OPTIONAL_INPUTS]);
export function validateProviderDefinition(file, input) {
    const errors = [];
    const add = (path, code, message) => {
        if (errors.length < PROVIDER_LIMITS.errors)
            errors.push({ file, path, code, message });
    };
    const root = objectAt(input, '', TOP_KEYS, add);
    if (!root)
        return { ok: false, errors };
    const schemaVersion = text(root.schema_version, 'schema_version', 1, add);
    if (schemaVersion !== '1')
        add('schema_version', 'unsupported_schema_version', 'Schema version is not supported');
    const id = text(root.id, 'id', 64, add);
    if (id && !SLUG.test(id))
        add('id', 'invalid_slug', 'Value must be a lowercase slug');
    const filenameId = /^providers\/([a-z0-9-]+)\.yaml$/.exec(file)?.[1];
    if (!filenameId || id !== filenameId)
        add('id', 'filename_mismatch', 'Provider id must match its filename');
    const name = text(root.name, 'name', 120, add);
    const description = text(root.description, 'description', 1_000, add);
    const websiteUrl = httpsUrl(root.website_url, 'website_url', add);
    const documentationUrl = httpsUrl(root.documentation_url, 'documentation_url', add);
    const adapter = text(root.adapter, 'adapter', 64, add);
    if (adapter && !SLUG.test(adapter))
        add('adapter', 'invalid_slug', 'Value must be a lowercase slug');
    const status = enumValue(root.status, 'status', ['active', 'degraded', 'retired'], add);
    const available = booleanValue(root.available, 'available', add);
    const enabledByDefault = booleanValue(root.enabled_by_default, 'enabled_by_default', add);
    const endpoint = objectAt(root.endpoint, 'endpoint', ['api_base_url', 'method', 'path'], add);
    const apiBaseUrl = endpoint ? httpsUrl(endpoint.api_base_url, 'endpoint.api_base_url', add) : undefined;
    const method = endpoint ? enumValue(endpoint.method, 'endpoint.method', ['GET', 'POST'], add) : undefined;
    const requestPath = endpoint ? relativePath(endpoint.path, 'endpoint.path', add) : undefined;
    const adapterPolicy = adapter ? getAdapterPolicy(adapter) : undefined;
    if (adapterPolicy && apiBaseUrl && requestPath && method && (apiBaseUrl !== `${adapterPolicy.origin}${adapterPolicy.basePath}`
        || !isAllowedAdapterUrl(adapter, new URL(requestPath, apiBaseUrl).toString())
        || requestPath !== adapterPolicy.path
        || method !== adapterPolicy.method))
        add('endpoint.api_base_url', 'adapter_origin_mismatch', 'Endpoint is not allowed for this adapter');
    const capabilities = objectAt(root.capabilities, 'capabilities', ['operations', 'optional_inputs'], add);
    const operations = capabilities ? stringList(capabilities.operations, 'capabilities.operations', new Set(['search']), add) : [];
    if (operations.length !== 1 || operations[0] !== 'search')
        add('capabilities.operations', 'invalid_operations', 'Exactly the search operation is required');
    const optionalInputs = capabilities ? stringList(capabilities.optional_inputs, 'capabilities.optional_inputs', OPTIONAL_INPUTS, add) : [];
    const authentication = objectAt(root.authentication, 'authentication', ['credential_mode', 'fields'], add);
    const credentialMode = authentication ? enumValue(authentication.credential_mode, 'authentication.credential_mode', ['none', 'user', 'platform', 'user_or_platform'], add) : undefined;
    const fields = [];
    if (authentication) {
        if (!Array.isArray(authentication.fields) || authentication.fields.length > PROVIDER_LIMITS.credentials)
            add('authentication.fields', 'invalid_collection', 'Credential fields must be a bounded list');
        else {
            const names = new Set();
            authentication.fields.forEach((value, index) => {
                const field = objectAt(value, `authentication.fields.${index}`, ['name', 'label'], add);
                if (!field)
                    return;
                const fieldName = text(field.name, `authentication.fields.${index}.name`, 64, add);
                const label = text(field.label, `authentication.fields.${index}.label`, 120, add);
                if (fieldName && (!FIELD.test(fieldName) || PROTOTYPE_KEYS.has(fieldName)))
                    add(`authentication.fields.${index}.name`, 'unsafe_field', 'Credential field name is not allowed');
                if (fieldName && names.has(fieldName))
                    add(`authentication.fields.${index}.name`, 'duplicate', 'Credential field names must be unique');
                if (fieldName && label) {
                    names.add(fieldName);
                    fields.push({ name: fieldName, label });
                }
            });
        }
    }
    if (credentialMode === 'none' && fields.length)
        add('authentication.fields', 'unexpected_fields', 'Credential fields are not allowed for this mode');
    const requestMapping = objectAt(root.request_mapping, 'request_mapping', ['query', 'body'], add);
    const query = requestMapping ? mapping(requestMapping.query, 'request_mapping.query', add) : {};
    const body = requestMapping ? mapping(requestMapping.body, 'request_mapping.body', add) : {};
    const responseMapping = objectAt(root.response_mapping, 'response_mapping', ['results', 'title', 'url', 'snippet', 'rank'], add);
    const results = responseMapping ? responsePath(responseMapping.results, 'response_mapping.results', add) : [];
    const title = responseMapping ? responsePath(responseMapping.title, 'response_mapping.title', add) : [];
    const url = responseMapping ? responsePath(responseMapping.url, 'response_mapping.url', add) : [];
    const snippet = responseMapping ? responsePath(responseMapping.snippet, 'response_mapping.snippet', add) : [];
    const rank = responseMapping?.rank === undefined ? undefined : responsePath(responseMapping.rank, 'response_mapping.rank', add);
    let metadata;
    if (root.metadata !== undefined) {
        const value = objectAt(root.metadata, 'metadata', ['rate_limit', 'pricing', 'pricing_url', 'example_request', 'example_response'], add);
        if (value) {
            const rateLimit = optionalText(value.rate_limit, 'metadata.rate_limit', 500, add);
            const pricing = optionalText(value.pricing, 'metadata.pricing', 500, add);
            const pricingUrl = value.pricing_url === undefined ? undefined : httpsUrl(value.pricing_url, 'metadata.pricing_url', add);
            if (value.example_request !== undefined)
                validateExample(value.example_request, 'metadata.example_request', add);
            if (value.example_response !== undefined)
                validateExample(value.example_response, 'metadata.example_response', add);
            metadata = cleanObject({ rate_limit: rateLimit, pricing, pricing_url: pricingUrl, example_request: value.example_request, example_response: value.example_response });
        }
    }
    if (errors.length || !id || !name || !description || !websiteUrl || !documentationUrl || !adapter || !status || available === undefined || enabledByDefault === undefined || !apiBaseUrl || !method || !requestPath || !credentialMode)
        return { ok: false, errors };
    const definition = cleanObject({
        schema_version: '1', id, name, description, website_url: websiteUrl, documentation_url: documentationUrl,
        adapter, status, available: available && Boolean(getAdapterPolicy(adapter)), enabled_by_default: enabledByDefault,
        endpoint: { api_base_url: apiBaseUrl, method, path: requestPath },
        capabilities: { operations: ['search'], optional_inputs: optionalInputs },
        authentication: { credential_mode: credentialMode, fields }, request_mapping: { query, body },
        response_mapping: cleanObject({ results, title, url, snippet, rank }), metadata,
    });
    const canonicalJson = canonicalStringify(definition);
    if (new TextEncoder().encode(canonicalJson).length > PROVIDER_LIMITS.definitionBytes)
        return { ok: false, errors: [{ file, path: '', code: 'definition_too_large', message: 'Normalized definition exceeds the size limit' }] };
    return { ok: true, definition, canonicalJson };
}
export function validateProviderRevision(files) {
    if (!files.length)
        return { ok: false, errors: [{ file: 'providers/', path: '', code: 'empty_revision', message: 'Revision has no provider definitions' }] };
    const errors = [];
    const definitions = [];
    const ids = new Set();
    for (const file of [...files].sort((a, b) => a.file.localeCompare(b.file))) {
        const result = validateProviderDefinition(file.file, file.value);
        if (!result.ok)
            errors.push(...result.errors);
        else if (ids.has(result.definition.id))
            errors.push({ file: file.file, path: 'id', code: 'duplicate_provider', message: 'Provider ids must be unique' });
        else {
            ids.add(result.definition.id);
            definitions.push({ file: file.file, ...result });
        }
    }
    return errors.length ? { ok: false, errors: boundErrors(errors) } : { ok: true, definitions };
}
export async function checksumCanonicalJson(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function canonicalStringify(value) {
    return JSON.stringify(sortValue(value));
}
export function boundErrors(errors) {
    const output = [];
    for (const error of errors.slice(0, PROVIDER_LIMITS.errors)) {
        const candidate = [...output, error];
        if (new TextEncoder().encode(JSON.stringify(candidate)).length > PROVIDER_LIMITS.errorReportBytes)
            break;
        output.push(error);
    }
    return output;
}
function objectAt(value, path, allowed, add) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
        add(path, 'expected_object', 'Value must be an object');
        return;
    }
    const object = value;
    for (const key of Object.keys(object))
        if (!allowed.includes(key))
            add(path ? `${path}.[unknown]` : '[unknown]', 'unknown_key', 'Unknown field is not allowed');
    return object;
}
function text(value, path, max, add) {
    if (typeof value !== 'string' || !value.trim()) {
        add(path, 'required_text', 'Value must be non-empty text');
        return;
    }
    if (new TextEncoder().encode(value).length > Math.min(max, PROVIDER_LIMITS.stringBytes)) {
        add(path, 'text_too_long', 'Text exceeds the size limit');
        return;
    }
    return value.trim();
}
function optionalText(value, path, max, add) { return value === undefined ? undefined : text(value, path, max, add); }
function booleanValue(value, path, add) { if (typeof value !== 'boolean') {
    add(path, 'expected_boolean', 'Value must be a boolean');
    return;
} ; return value; }
function enumValue(value, path, values, add) { if (typeof value !== 'string' || !values.includes(value)) {
    add(path, 'invalid_value', 'Value is not allowed');
    return;
} ; return value; }
function httpsUrl(value, path, add) {
    const string = text(value, path, 2_048, add);
    if (!string)
        return;
    try {
        const url = new URL(string);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || isUnsafeHostname(url.hostname))
            throw new Error();
        return url.toString();
    }
    catch {
        add(path, 'unsafe_url', 'Value must be a safe HTTPS URL');
        return;
    }
}
function isUnsafeHostname(hostname) { return /(^|\.)(localhost|local|internal)$/i.test(hostname) || /^\[.*\]$/.test(hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname); }
function relativePath(value, path, add) {
    const string = text(value, path, 512, add);
    if (!string)
        return;
    if (!string.startsWith('/') || string.startsWith('//') || /[\\?#]/.test(string) || /(?:^|\/)(?:\.{1,2}|%2e)(?:\/|%2f|$)/i.test(string)) {
        add(path, 'unsafe_path', 'Path must be a normalized relative path');
        return;
    }
    return string;
}
function stringList(value, path, allowed, add) {
    if (!Array.isArray(value) || value.length > PROVIDER_LIMITS.listItems) {
        add(path, 'invalid_collection', 'Value must be a bounded list');
        return [];
    }
    const result = [];
    const seen = new Set();
    value.forEach((item, index) => { if (typeof item !== 'string' || !allowed.has(item))
        add(`${path}.${index}`, 'invalid_value', 'Value is not allowed');
    else if (seen.has(item))
        add(`${path}.${index}`, 'duplicate', 'Values must be unique');
    else {
        seen.add(item);
        result.push(item);
    } });
    return result;
}
function mapping(value, path, add) {
    const object = objectAt(value, path, [...SOURCE_FIELDS], add);
    if (!object)
        return {};
    if (Object.keys(object).length > PROVIDER_LIMITS.mappings)
        add(path, 'invalid_collection', 'Mapping has too many entries');
    const result = {};
    for (const [source, destination] of Object.entries(object)) {
        if (!SOURCE_FIELDS.has(source))
            continue;
        if (typeof destination !== 'string' || !FIELD.test(destination) || SECRET_KEY.test(destination) || PROTOTYPE_KEYS.has(destination))
            add(`${path}.${source}`, 'unsafe_mapping', 'Mapping destination is not allowed');
        else
            result[source] = destination;
    }
    return result;
}
function responsePath(value, path, add) {
    if (!Array.isArray(value) || !value.length || value.length > PROVIDER_LIMITS.responsePathSegments) {
        add(path, 'invalid_path', 'Response path must be a bounded non-empty list');
        return [];
    }
    const result = [];
    value.forEach((segment, index) => {
        if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0)
            result.push(segment);
        else if (typeof segment === 'string' && PATH_SEGMENT.test(segment) && !PROTOTYPE_KEYS.has(segment))
            result.push(segment);
        else
            add(`${path}.${index}`, 'unsafe_path_segment', 'Response path segment is not allowed');
    });
    return result;
}
function validateExample(value, path, add) {
    let bytes = 0;
    try {
        bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    }
    catch {
        add(path, 'invalid_example', 'Example must be JSON data');
        return;
    }
    if (bytes > PROVIDER_LIMITS.exampleBytes)
        add(path, 'example_too_large', 'Example exceeds the size limit');
    const visit = (node, currentPath, depth) => {
        if (depth > PROVIDER_LIMITS.depth) {
            add(currentPath, 'too_deep', 'Example exceeds the depth limit');
            return;
        }
        if (typeof node === 'number' && !Number.isFinite(node))
            add(currentPath, 'invalid_number', 'Numbers must be finite');
        if (typeof node === 'string' && (SECRET_KEY.test(node) || SECRET_VALUE.test(node)))
            add(currentPath, 'secret_like_value', 'Secret-like example values are not allowed');
        if (Array.isArray(node)) {
            if (node.length > PROVIDER_LIMITS.listItems)
                add(currentPath, 'invalid_collection', 'Example list is too large');
            node.forEach((item, index) => visit(item, `${currentPath}.${index}`, depth + 1));
        }
        else if (node && typeof node === 'object')
            Object.entries(node).forEach(([key, item], index) => { const childPath = `${currentPath}.${index}`; if (SECRET_KEY.test(key) || PROTOTYPE_KEYS.has(key))
                add(childPath, 'unsafe_example_key', 'Example key is not allowed'); visit(item, childPath, depth + 1); });
    };
    visit(value, path, 0);
}
function cleanObject(value) { return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)); }
function sortValue(value) { if (Array.isArray(value))
    return value.map(sortValue); if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)])); return value; }
