import type { ExecutableProviderId, NormalizedSearchRequest, ProviderAdapter, ProviderAdapterContext, ProviderAdapterOutcome } from '../types.js';
export { braveAdapter } from './brave.js';
export { tavilyAdapter } from './tavily.js';
export declare const providerAdapters: Readonly<Record<ExecutableProviderId, ProviderAdapter>>;
export declare function getProviderAdapter(adapter: string): ProviderAdapter | undefined;
export declare function runProviderAdapter(adapter: string, request: NormalizedSearchRequest, context: ProviderAdapterContext): Promise<ProviderAdapterOutcome>;
