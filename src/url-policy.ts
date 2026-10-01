export type AdapterOriginPolicy = {
  origin: string
  basePath: string
  path: string
  method: 'GET' | 'POST'
}

const ADAPTER_POLICIES: Readonly<Record<string, AdapterOriginPolicy>> = Object.freeze({
  brave: { origin: 'https://api.search.brave.com', basePath: '/res/v1/', path: '/res/v1/web/search', method: 'GET' },
  tavily: { origin: 'https://api.tavily.com', basePath: '/', path: '/search', method: 'POST' },
})

const FORBIDDEN_HOSTS = /(^|\.)(localhost|local|internal)$/i

export function getAdapterPolicy(adapter: string): AdapterOriginPolicy | undefined {
  return ADAPTER_POLICIES[adapter]
}

export function isAllowedAdapterUrl(adapter: string, value: string): boolean {
  const policy = getAdapterPolicy(adapter)
  if (!policy) return false

  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) return false
    if (FORBIDDEN_HOSTS.test(url.hostname) || isIpLiteral(url.hostname)) return false
    return !url.search && url.origin === policy.origin && (url.pathname === policy.basePath || url.pathname === policy.path)
  } catch {
    return false
  }
}

function isIpLiteral(hostname: string): boolean {
  return /^\[.*\]$/.test(hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
}
