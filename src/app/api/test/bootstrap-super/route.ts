// BREAK-GLASS bootstrap (temporary, removed in the very next commit):
// creates one E2E-only super admin when BOOTSTRAP_TOKEN is configured.
//   • No BOOTSTRAP_TOKEN env  → this route does not exist (404), always.
//   • Wrong token             → 404 (indistinguishable from missing route).
//   • Email must end in @testsuper-test.in — real accounts can never be
//     created or touched through this endpoint.
//   • Password is random unless explicitly provided; returned exactly once.
//   • Every call is audit-logged (BOOTSTRAP_SUPER_CREATED).
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { HttpError } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getClientIp, timingSafeEqualStr, APP_SECRET } from '@/lib/security'
import bcrypt from 'bcryptjs'

export const dynamic = 'force-dynamic'

const GUARD_DOMAIN = '@testsuper-test.in'

export async function GET() {
  return new Response('Not found', { status: 404 })
}

export async function POST(req: Request) {
  return handleRoute(req, { rateLimit: { max: 5, windowMs: 60_000, bucket: 'bootstrap' } }, async () => {
    const token = process.env.BOOTSTRAP_TOKEN || ''
    const provided = req.headers.get('x-bootstrap-token') || ''
    // No token configured or mismatch → the endpoint "does not exist".
    if (!token || !provided || !timingSafeEqualStr(token, provided) || !APP_SECRET) {
      throw new HttpError(404, 'Not found')
    }

    const body = await req.json().catch(() => null) as { email?: string; password?: string } | null
    const email = (body?.email || '').toLowerCase().trim()
    if (!email || !email.endsWith(GUARD_DOMAIN)) {
      throw new HttpError(400, `email must end with ${GUARD_DOMAIN}`)
    }
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      throw new HttpError(409, 'Bootstrap user already exists')
    }

    const password = body?.password && body.password.length >= 12
      ? body.password
      : `E2e!${randomBytes(12).toString('base64url')}#9`
    const hash = await bcrypt.hash(password, 10)

    const user = await db.user.create({
      data: {
        email,
        passwordHash: hash,
        name: 'E2E Break-glass Super',
        role: 'SUPER_ADMIN',
        isActive: true,
        shopId: null,
      },
      select: { id: true, email: true },
    })

    await audit({
      actorType: 'SYSTEM',
      action: 'BOOTSTRAP_SUPER_CREATED',
      entity: 'User',
      entityId: user.id,
      meta: { email: user.email },
      ip: getClientIp(req),
    })

    return jsonOk({ ok: true, email: user.email, password })
  })
}
