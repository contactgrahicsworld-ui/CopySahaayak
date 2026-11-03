// DEV/TEST ONLY — never available in production builds.
// Clears rate-limit buckets so E2E runs stay deterministic and repeatable.
// Gated three ways:
//   1. NODE_ENV must be development (production builds return 404 below)
//   2. Requires the x-internal-secret header matching APP_SECRET
//   3. POST only
import { jsonOk } from '@/lib/api'
import { resetSharedRateLimitsForTests } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 })
  }
  const secret = req.headers.get('x-internal-secret')
  if (!secret || secret !== process.env.APP_SECRET) {
    return new Response('Not Found', { status: 404 })
  }
  await resetSharedRateLimitsForTests()
  return jsonOk({ ok: true, reset: 'rate-limits' })
}
