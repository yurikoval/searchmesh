export declare const PROVIDER_LIMITS: Readonly<{
    sourceBytes: number;
    filesPerRevision: 50;
    revisionBytes: number;
    nodes: 1000;
    depth: 12;
    mapKeys: 40;
    listItems: 50;
    stringBytes: 4096;
    definitionBytes: number;
    mappings: 20;
    credentials: 10;
    responsePathSegments: 12;
    exampleBytes: number;
    errors: 20;
    errorReportBytes: number;
}>;
export type ValidationError = {
    file: string;
    path: string;
    code: string;
    message: string;
};
export type PathSegment = string | number;
export type ProviderDefinition = {
    schema_version: '1';
    id: string;
    name: string;
    description: string;
    website_url: string;
    documentation_url: string;
    adapter: string;
    endpoint: {
        api_base_url: string;
        method: 'GET' | 'POST';
        path: string;
    };
    capabilities: {
        operations: ['search'];
        optional_inputs: Array<'language' | 'region' | 'safe_search' | 'time_range'>;
    };
    authentication: {
        fields: Array<{
            name: string;
            label: string;
        }>;
    };
    request_mapping: {
        query: Partial<Record<'query' | 'language' | 'region' | 'safe_search' | 'time_range', string>>;
        body: Partial<Record<'query' | 'language' | 'region' | 'safe_search' | 'time_range', string>>;
    };
    response_mapping: {
        results: PathSegment[];
        title: PathSegment[];
        url: PathSegment[];
        snippet: PathSegment[];
        rank?: PathSegment[];
    };
    metadata?: {
        rate_limit?: string;
        pricing?: string;
        pricing_url?: string;
        example_request?: unknown;
        example_response?: unknown;
    };
};
export declare function validateProviderDefinition(file: string, input: unknown): {
    ok: true;
    definition: ProviderDefinition;
    canonicalJson: string;
} | {
    ok: false;
    errors: ValidationError[];
};
export declare function validateProviderRevision(files: Array<{
    file: string;
    value: unknown;
}>): {
    ok: true;
    definitions: Array<{
        file: string;
        definition: ProviderDefinition;
        canonicalJson: string;
    }>;
} | {
    ok: false;
    errors: ValidationError[];
};
export declare function checksumCanonicalJson(value: string): Promise<string>;
export declare function canonicalStringify(value: unknown): string;
export declare function boundErrors(errors: ValidationError[]): ValidationError[];
