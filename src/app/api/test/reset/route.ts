// Dev/test isolation endpoint: clears rate-limit buckets (in-memory + shared
// Postgres rows) so E2E suites are re-runnable. Gated by the deployment's
// APP_SECRET via the x-internal-secret header — without it this is always 404.
import { NextResponse } from 'next/server'
import { resetSharedRateLimitsForTests } from '@/lib/rate-limit'
import { APP_SECRET } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const provided = req.headers.get('x-internal-secret') || ''
  if (!APP_SECRET || provided.length !== APP_SECRET.length || provided !== APP_SECRET) {
    return new NextResponse(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }
  await resetSharedRateLimitsForTests()
  return NextResponse.json({ ok: true })
}
