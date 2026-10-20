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
| [GitLab](https://about.gitlab.com/) | [Docs](https://docs.gitlab.com/api/projects/) |
| [GitHub Repository Search](https://github.com/) | [Docs](https://docs.github.com/en/rest/search/search) |
| [OpenAlex](https://openalex.org/) | [Docs](https://docs.openalex.org/api-entities/works/search-works) |
| [X Full-Archive Post Search](https://x.com/) | [Docs](https://docs.x.com/x-api/posts/search-all-posts) |


### Todo

| Source | Relevant API / automation path |
| --- | --- |
| [Reddit](https://www.reddit.com/dev/api/) | [Reddit API](https://www.reddit.com/dev/api/) and RSS/Atom feeds where permitted |
| [YouTube](https://developers.google.com/youtube/v3) | [YouTube Data API search](https://developers.google.com/youtube/v3/docs/search/list); transcripts require separately permitted [caption access](https://developers.google.com/youtube/v3/docs/captions) |
| [Hacker News](https://news.ycombinator.com/) | [Official Firebase API](https://github.com/HackerNews/API) |
| [Polymarket](https://polymarket.com/) | [Gamma API](https://docs.polymarket.com/developers/gamma-markets-api/overview) and [CLOB API](https://docs.polymarket.com/developers/CLOB/introduction) |
| [GitHub](https://github.com/) | [REST search API](https://docs.github.com/en/rest/search/search) and [GraphQL API](https://docs.github.com/en/graphql) |
| [arXiv](https://arxiv.org/) | [Public Atom API](https://info.arxiv.org/help/api/index.html) |
| [TikTok](https://www.tiktok.com/) | [Research API video search](https://developers.tiktok.com/docs/en/research-api-specs-query-videos) is restricted and not a general-purpose API; commercial/partner access may be possible |
| [Instagram Reels](https://www.instagram.com/reels/) | [Instagram Graph API hashtag search](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-hashtag-search) requires permissions and professional-account context; general public search is not available |
| [LinkedIn](https://www.linkedin.com/) | [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api) access is restricted to approved use cases and does not provide general public post search |
| [Meta Ads](https://www.facebook.com/ads/library/) | [Meta Ad Library API](https://www.facebook.com/ads/library/api/) is automatable, but requires access-token/app setup and is a distinct ads-search integration |
| [StockTwits](https://stocktwits.com/) | [Official developer portal](https://api.stocktwits.com/developers); new developer registrations are currently unavailable while the API program is under review |
| [Threads](https://www.threads.com/) | [Threads API](https://developers.facebook.com/docs/threads/) supports publishing and account data, but not broad public search |
| [Pinterest](https://www.pinterest.com/) | [Pinterest API v5](https://developers.pinterest.com/docs/api/v5/) supports approved business/content use cases, not unrestricted public Pin search |
| [Xiaohongshu (RED)](https://www.xiaohongshu.com/) | The official [API reference](https://openaccount.xiaohongshu.com/docs/api-reference) and [authorization scopes](https://openaccount.xiaohongshu.com/docs/scope) do not provide general public-post search |
| [Bluesky](https://bsky.app/) | [AT Protocol post-search API](https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/searchPosts.json) supports automated public-post search |
| [Truth Social](https://truthsocial.com/) | Its official [publisher documentation](https://help.truthsocial.com/publishers/) does not document a general public search API |
| [DripStack](https://dripstack.xyz/) | A public [`/api/v1/search`](https://dripstack.xyz/api/v1/search) endpoint exists, but no official API documentation was identified; stability and terms require verification |

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

### Provider categories

Provider definitions may use these controlled categories for coarse filtering:

- `general-web`: general web or publicly accessible web content search
- `independent-index`: web search backed by the provider's own index
- `semantic-search`: semantic or neural retrieval
- `ai-research`: search structured for AI research workflows
- `serp-data`: structured search engine results page data

Use existing categories before proposing a new value. Categories describe useful specializations; they do not rank providers or report live availability.

## Development

```sh
npm install
npm run check
npm pack --dry-run
```

Provider adapters use standard Web APIs and run in Node.js 22+ and Cloudflare Workers.
