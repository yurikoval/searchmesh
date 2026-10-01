# SearchMesh

Provider integrations and validated provider definitions for SearchMesh. This package contains no portal, persistence, account, or routing logic.

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

The package includes compiled adapters for Brave Search and Tavily Search. Their registry definitions live in `providers/` and are validated by the package test suite.

## Development

```sh
npm install
npm run check
npm pack --dry-run
```

Provider adapters use standard Web APIs and run in Node.js 22+ and Cloudflare Workers.
