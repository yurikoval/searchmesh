# AGENTS.md

## Project

SearchMesh is a small, runtime-neutral TypeScript package for search-provider adapters and validated provider definitions. It targets Node.js 22+ and Cloudflare Workers. Portal, persistence, account, credential-storage, and routing concerns do not belong here.

## Repository map

- `src/adapters/` — provider-specific request/response adapters and adapter registry
- `src/types.ts` — public provider and normalized-search contracts
- `src/normalize.ts` — bounded response parsing and normalization helpers
- `src/schema.ts` / `src/yaml.ts` — provider definition parsing and validation
- `src/url-policy.ts` — adapter endpoint allowlists
- `src/index.ts` — public package exports
- `providers/` — published provider YAML definitions
- `tests/` — Vitest tests and provider response fixtures
- `scripts/test-package.mjs` — packed-package runtime and type-consumer smoke test
- `dist/` — tracked build output; regenerate it rather than editing it directly

## Commands

```sh
npm install
npm run typecheck
npm test
npm run build
npm run test:package
npm run check
npm pack --dry-run
```

Run `npm run check` before considering a change complete. Run `npm pack --dry-run` when package contents or publishing metadata change.

## Conventions

- Use strict TypeScript and ESM. Relative TypeScript imports must use `.js` specifiers.
- Use standard Web APIs where possible so code remains compatible with Node and Workers.
- Keep the public API explicit through `src/index.ts`; export public types alongside runtime functions.
- Follow the existing style: single quotes, no semicolons, concise functions, and `import type` for type-only imports.
- Add focused Vitest coverage for behavior changes. Prefer realistic provider payloads in `tests/fixtures/`.
- Do not add portal-specific dependencies or business logic.
- Do not introduce dependencies when platform APIs or existing code suffice.

## Security and contract invariants

Provider definitions and responses are untrusted input. Preserve all existing bounds on bytes, depth, collection sizes, normalized output, errors, and retry delays.

- Keep provider endpoints HTTPS-only and constrained by `src/url-policy.ts`; do not allow arbitrary hosts, credentials in URLs, fragments, IP literals, or local/internal hosts.
- Never log, persist, return, or place credentials in URLs. Keep examples and fixtures free of real secrets.
- Reject prototype-pollution keys and secret-like fields/values in definitions and examples.
- Cancel rejected or oversized response bodies where practical.
- Return normalized provider failures rather than leaking upstream response bodies or sensitive details.
- Treat exported types, failure codes/messages, normalization limits, canonical JSON, and provider YAML shape as public contracts.

## Adding or changing a provider

1. Add or update its adapter in `src/adapters/`.
2. Register it in `src/adapters/index.ts` and update the executable provider ID type if needed.
3. Add or update its exact endpoint policy in `src/url-policy.ts`.
4. Add or update `providers/<id>.yaml`; the definition ID must match the filename.
5. Add adapter tests, sanitized response fixtures, and update `tests/definitions.test.ts`.
6. Run `npm run check` so tracked `dist/` output and the packed-package contract are verified.
