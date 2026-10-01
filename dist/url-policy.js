const ADAPTER_POLICIES = Object.freeze({
    brave: { origin: 'https://api.search.brave.com', basePath: '/res/v1/', path: '/res/v1/web/search', method: 'GET' },
    tavily: { origin: 'https://api.tavily.com', basePath: '/', path: '/search', method: 'POST' },
    exa: { origin: 'https://api.exa.ai', basePath: '/', path: '/search', method: 'POST' },
    yep: { origin: 'https://platform.yep.com', basePath: '/api/', path: '/api/search', method: 'POST' },
    kagi: { origin: 'https://kagi.com', basePath: '/api/v1/', path: '/api/v1/search', method: 'POST' },
});
const FORBIDDEN_HOSTS = /(^|\.)(localhost|local|internal)$/i;
export function getAdapterPolicy(adapter) {
    return ADAPTER_POLICIES[adapter];
}
export function isAllowedAdapterUrl(adapter, value) {
    const policy = getAdapterPolicy(adapter);
    if (!policy)
        return false;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443'))
            return false;
        if (FORBIDDEN_HOSTS.test(url.hostname) || isIpLiteral(url.hostname))
            return false;
        return !url.search && url.origin === policy.origin && (url.pathname === policy.basePath || url.pathname === policy.path);
    }
    catch {
        return false;
    }
}
function isIpLiteral(hostname) {
    return /^\[.*\]$/.test(hostname) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}
