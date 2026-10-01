import { providerFailure } from '../normalize.js';
import { braveAdapter } from './brave.js';
import { tavilyAdapter } from './tavily.js';
export { braveAdapter } from './brave.js';
export { tavilyAdapter } from './tavily.js';
export const providerAdapters = Object.freeze({
    brave: braveAdapter,
    tavily: tavilyAdapter,
});
export function getProviderAdapter(adapter) {
    return providerAdapters[adapter];
}
export async function runProviderAdapter(adapter, request, context) {
    const implementation = getProviderAdapter(adapter);
    return implementation ? implementation(request, context) : { ok: false, failure: providerFailure(context.providerId, 'provider_configuration_error') };
}
