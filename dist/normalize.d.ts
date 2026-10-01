import { type NormalizedSearchResult, type ProviderFailure, type ProviderFailureCode } from './types.js';
export declare class InvalidProviderResponse extends Error {
}
export declare function providerFailure(providerId: string, code: ProviderFailureCode, details?: {
    httpStatus?: number;
    retryAfterMs?: number;
}): ProviderFailure;
export declare function responseFailure(providerId: string, response: Response, now?: number): ProviderFailure | undefined;
export declare function fetchFailure(providerId: string, signal: AbortSignal): ProviderFailure;
export declare function cancelResponseBody(response: Response): Promise<void>;
export declare function readBoundedJson(response: Response): Promise<unknown>;
export declare function isPlainRecord(value: unknown): value is Record<string, unknown>;
export declare function boundedText(value: unknown, maxCharacters: number): string | undefined;
export declare function normalizedUrl(value: unknown): {
    url: string;
    domain: string;
} | undefined;
export declare function normalizedDate(value: unknown): string | undefined;
export declare function finiteNumber(value: unknown): number | undefined;
export declare function normalizeMetadata(value: unknown, allowedKeys: readonly string[]): Readonly<Record<string, string | number | boolean | null>> | undefined;
export declare function boundNormalizedResults(results: NormalizedSearchResult[]): readonly NormalizedSearchResult[];
export declare function parseRetryAfter(value: string | null, now?: number): number | undefined;
