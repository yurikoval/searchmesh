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

### Other candidates

- [You.com](https://you.com/) — structured web and news results with extracted page content ([API docs](https://you.com/docs/guides/search))
- [Perplexity](https://www.perplexity.ai/) — raw ranked web results with search filters ([API docs](https://docs.perplexity.ai/docs/search/quickstart))
- [Mojeek](https://www.mojeek.com/) — an independent web index that would diversify result sources ([API docs](https://www.mojeek.com/support/api/))
- [SerpApi](https://serpapi.com/) — structured Google results for SERP-specific use cases ([API docs](https://serpapi.com/search-api))

## Install

```sh
npm install searchmesh
```

## Use

```ts
import {
  getProviderAdapter,
  parseProviderYaml,
  runProviderAdapter,
  validateProviderDefinition,
  type ProviderAdapterContext,
  type NormalizedSearchRequest,
} from 'searchmesh'
```

The package includes compiled adapters for Brave Search, Tavily Search, Yep, Exa, and Kagi. Their registry definitions live in `providers/` and are validated by the package test suite.

## Development

```sh
npm install
npm run check
npm pack --dry-run
```

Provider adapters use standard Web APIs and run in Node.js 22+ and Cloudflare Workers.
