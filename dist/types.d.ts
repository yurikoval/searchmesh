import type { ProviderDefinition } from './schema.js';
export declare const PROVIDER_ADAPTER_LIMITS: Readonly<{
    queryCharacters: 600;
    queryWords: 75;
    results: 20;
    responseBytes: 1048576;
    normalizedBytes: 262144;
    credentialBytes: 4096;
    titleCharacters: 500;
    urlCharacters: 2048;
    displayUrlCharacters: 2048;
    snippetCharacters: 4000;
    contentExcerptCharacters: 4000;
    authorCharacters: 200;
    contentTypeCharacters: 100;
    metadataEntries: 8;
    metadataBytes: 2048;
    retryAfterMs: 300000;
}>;
export type ExecutableProviderId = 'brave' | 'tavily';
export type NormalizedSearchRequest = Readonly<{
    query: string;
    limit: number;
    language?: string;
    region?: string;
    safeSearch?: 'off' | 'moderate' | 'strict';
    timeRange?: 'day' | 'week' | 'month' | 'year';
}>;
export type NormalizedSearchResult = Readonly<{
    providerId: ExecutableProviderId;
    providerRank: number;
    title: string;
    url: string;
    domain: string;
    displayUrl?: string;
    snippet?: string;
    contentExcerpt?: string;
    publishedAt?: string;
    author?: string;
    imageUrl?: string;
    contentType?: string;
    providerScore?: number;
    metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;
export type ProviderFailureCode = 'provider_configuration_error' | 'provider_unsupported_parameter' | 'provider_authentication_failed' | 'provider_rate_limited' | 'provider_rejected_request' | 'provider_timeout' | 'provider_unavailable' | 'provider_invalid_response' | 'provider_error';
export type ProviderFailure = Readonly<{
    providerId: string;
    code: ProviderFailureCode;
    retryable: boolean;
    message: string;
    httpStatus?: number;
    retryAfterMs?: number;
}>;
export type ProviderAdapterOutcome = Readonly<{
    ok: true;
    providerId: ExecutableProviderId;
    results: readonly NormalizedSearchResult[];
}> | Readonly<{
    ok: false;
    failure: ProviderFailure;
}>;
export type ProviderAdapterContext = Readonly<{
    providerId: string;
    definition: ProviderDefinition;
    credentials: Readonly<Record<string, string>>;
    signal: AbortSignal;
    fetch?: typeof fetch;
}>;
export type ProviderAdapter = (request: NormalizedSearchRequest, context: ProviderAdapterContext) => Promise<ProviderAdapterOutcome>;
