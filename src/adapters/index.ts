import { providerFailure } from '../normalize.js'
import type { ExecutableProviderId, NormalizedSearchRequest, ProviderAdapter, ProviderAdapterContext, ProviderAdapterOutcome } from '../types.js'
import { braveAdapter } from './brave.js'
import { tavilyAdapter } from './tavily.js'
import { exaAdapter } from './exa.js'
import { yepAdapter } from './yep.js'
import { kagiAdapter } from './kagi.js'

export { braveAdapter } from './brave.js'
export { tavilyAdapter } from './tavily.js'
export { exaAdapter } from './exa.js'
export { yepAdapter } from './yep.js'
export { kagiAdapter } from './kagi.js'

export const providerAdapters: Readonly<Record<ExecutableProviderId, ProviderAdapter>> = Object.freeze({
  brave: braveAdapter,
  tavily: tavilyAdapter,
  exa: exaAdapter,
  yep: yepAdapter,
  kagi: kagiAdapter,
})

export function getProviderAdapter(adapter: string): ProviderAdapter | undefined {
  return providerAdapters[adapter as ExecutableProviderId]
}

export async function runProviderAdapter(adapter: string, request: NormalizedSearchRequest, context: ProviderAdapterContext): Promise<ProviderAdapterOutcome> {
  const implementation = getProviderAdapter(adapter)
  return implementation ? implementation(request, context) : { ok: false, failure: providerFailure(context.providerId, 'provider_configuration_error') }
}
