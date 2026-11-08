// Public authority-transfer link endpoints (token in the URL = the bearer proof,
// like a forgot-password mail link):
// GET  /api/transfer/[token] — safe details for the accept page (no secrets)
// POST /api/transfer/[token] — accept: set own password, receive the complete
//                              authority; auto-signs the new authority in.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { transferAcceptSchema } from '@/lib/validation'
import { getClientIp, sha256 } from '@/lib/security'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { acceptTransfer } from '@/lib/transfer'
import { createAdminSession, setSessionCookie } from '@/lib/auth'
import { ensureSupabaseAuthUser } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

async function loadTransfer(token: string) {
  return db.authorityTransfer.findUnique({
    where: { tokenHash: sha256(token) },
    include: { shop: { select: { name: true, slug: true } } },
  })
}

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'transfer-view' }, checkOrigin: false },
    async () => {
      const { token } = await params
      const t = await loadTransfer(token)
      if (!t) return jsonError(404, 'This authority-transfer link is not valid.')
      if (t.status !== 'PENDING') {
        return jsonError(410, `This transfer was already ${t.status.toLowerCase()}.`)
      }
      if (t.expiresAt < new Date()) {
        await db.authorityTransfer.updateMany({ where: { id: t.id, status: 'PENDING' }, data: { status: 'EXPIRED' } }).catch(() => {})
        return jsonError(410, 'This transfer link has expired.')
      }
      return jsonOk({
        transfer: {
          scope: t.scope,
          shopName: t.shop?.name ?? null,
          toName: t.toName,
          toEmail: t.toEmail,
          fromEmail: t.fromEmail,
          expiresAt: t.expiresAt.toISOString(),
        },
      })
    }
  )
}

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.transferAccept, bucket: 'transfer-accept' } },
    async () => {
      const { token } = await params
      const body = transferAcceptSchema.parse(await req.json())
      const ip = getClientIp(req)
      const result = await acceptTransfer(token, body.password, body.name, ip)

      // Best-effort: mirror the new account so email-OTP password reset works
      // for the new authority from day one.
      const t = await loadTransfer(token)
      const toEmail = t?.toEmail
      if (toEmail) await ensureSupabaseAuthUser(toEmail).catch(() => null)

      // Auto sign-in — the new authority lands straight in their dashboard.
      const sessionToken = await createAdminSession(result.userId, ip, req.headers.get('user-agent') || undefined)
      await setSessionCookie(sessionToken)
      return jsonOk({ ok: true, scope: result.scope, shopSlug: result.shopSlug, redirect: result.redirect })
    }
  )
}
