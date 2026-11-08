// Test-only mail outbox inspection — reads the in-memory capture used when
// MAIL_MOCK=1. Gated by the deployment's APP_SECRET (x-internal-secret header),
// same pattern as /api/test/reset; without the secret this is always 404.
// Lets E2E suites verify that authority-transfer / OTP mails really went out.
import { NextResponse } from 'next/server'
import { mockOutbox } from '@/lib/mailer'
import { APP_SECRET } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const provided = req.headers.get('x-internal-secret') || ''
  if (!APP_SECRET || provided.length !== APP_SECRET.length || provided !== APP_SECRET) {
    return new NextResponse(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  }
  const box = mockOutbox()
  return NextResponse.json({
    count: box.length,
    mails: box.map((m) => ({ to: m.to, subject: m.subject, text: m.text, html: m.html })),
  })
}
