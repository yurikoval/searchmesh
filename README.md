# SearchMesh

Provider integrations and validated provider definitions for SearchMesh. This package contains no portal, persistence, account, or routing logic.

## Providers

### Supported

| Provider | API documentation |
| --- | --- |
| [Brave Search](https://brave.com/search/api/) | [Docs](https://api-dashboard.search.brave.com/documentation) |
| [Tavily](https://www.tavily.com/) | [Docs](https://docs.tavily.com/welcome) |
| [Yep](https://yep.com/) | [Docs](https://platform.yep.com/api-documentation) |
| [Exa](https://exa.ai/) | [Docs](https://exa.ai/docs/reference/search) |
| [Kagi](https://kagi.com/) | [Docs](https://help.kagi.com/kagi/api/search.html) |
| [You.com](https://you.com/) | [Docs](https://you.com/docs/api-reference/search/v1-search) |
| [Perplexity](https://www.perplexity.ai/) | [Docs](https://docs.perplexity.ai/api-reference/search-post) |
| [Mojeek](https://www.mojeek.com/) | [Docs](https://www.mojeek.com/support/api/search/) |
| [SerpApi](https://serpapi.com/) | [Docs](https://serpapi.com/search-api) |
| [DataForSEO](https://dataforseo.com/) | [Docs](https://docs.dataforseo.com/v3/serp-se-type-live-advanced/) |

## Install

```sh
npm install searchmesh
```

## Use

```ts
import { runProviderAdapter } from 'searchmesh'

const outcome = await runProviderAdapter(
  'brave',
  { query: 'runtime-neutral search', limit: 5 },
  {
    credentials: { api_key: 'your-api-key' },
    signal: new AbortController().signal,
  },
)
```

The package includes compiled adapters for all supported providers. Callers supply only credentials and runtime controls; provider identity, endpoint, capabilities, mappings, and credential contracts are compiled into each adapter. Lean integration definitions live in `providers/` and are validated by the package test suite.

## Development

```sh
npm install
npm run check
npm pack --dry-run
```

Provider adapters use standard Web APIs and run in Node.js 22+ and Cloudflare Workers.
