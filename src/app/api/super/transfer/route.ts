// Super-admin Authority Transfer (Power of Attorney) for the whole PLATFORM:
// GET    — currently pending platform transfer
// POST   — initiate: own password confirmed, one-time email link to the new owner
// DELETE — cancel a pending transfer
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { transferInitiateSchema } from '@/lib/validation'
import { getClientIp } from '@/lib/security'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { pendingTransfer, initiateTransfer, cancelPendingTransfer } from '@/lib/transfer'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const pending = await pendingTransfer('PLATFORM', { fromUserId: ctx.user.id })
    return jsonOk({ pending })
  })
}

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.transfer, bucket: 'transfer' } },
    async () => {
      const ctx = await requireSuper()
      const body = transferInitiateSchema.parse(await req.json())
      const me = await db.user.findUnique({ where: { id: ctx.user.id } })
      if (!me || !me.isActive) return jsonError(401, 'Authentication required')

      const result = await initiateTransfer({
        scope: 'PLATFORM',
        fromUserId: me.id,
        fromEmail: me.email,
        fromName: me.name,
        fromPasswordHash: me.passwordHash,
        toName: body.toName,
        toEmail: body.toEmail,
        currentPassword: body.currentPassword,
        ip: getClientIp(req),
      })
      return jsonOk(result)
    }
  )
}

export async function DELETE(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const count = await cancelPendingTransfer({
      scope: 'PLATFORM',
      fromUserId: ctx.user.id,
      userId: ctx.user.id,
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, cancelled: count })
  })
}
