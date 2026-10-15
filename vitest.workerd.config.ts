import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

const requests = { provider: 0, target: 0 }

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.jsonc' },
      miniflare: {
        outboundService(request) {
          const url = new URL(request.url)
          if (url.origin === 'https://api.search.brave.com') {
            requests.provider++
            return new Response('redirect-body-canary', {
              status: 302,
              headers: { Location: 'https://redirect.example/location-canary' },
            })
          }
          if (url.origin === 'https://redirect.example') {
            requests.target++
            return new Response('redirect-target-canary', { status: 418 })
          }
          if (url.href === 'https://assertions.test/counts') return Response.json(requests)
          return new Response(null, { status: 404 })
        },
      },
    }),
  ],
  test: {
    include: ['tests/workerd/**/*.test.ts'],
  },
})
