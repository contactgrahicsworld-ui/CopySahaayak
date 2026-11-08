// Shop-owner Authority Transfer (Power of Attorney): the shop owner hands the
// COMPLETE shop dashboard + payment collection to a new person by email.
// GET    — the currently pending transfer for this shop (for the UI banner)
// POST   — initiate: own password confirmed, one-time email link to the new person
// DELETE — cancel a pending transfer
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { transferInitiateSchema } from '@/lib/validation'
import { getClientIp } from '@/lib/security'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { pendingTransfer, initiateTransfer, cancelPendingTransfer } from '@/lib/transfer'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const pending = await pendingTransfer('SHOP', { shopId: ctx.user.shopId, fromUserId: ctx.user.id })
    return jsonOk({ pending })
  })
}

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.transfer, bucket: 'transfer' } },
    async () => {
      const ctx = await requireAnyShopAdmin()
      const body = transferInitiateSchema.parse(await req.json())
      const me = await db.user.findUnique({ where: { id: ctx.user.id } })
      if (!me || !me.isActive) return jsonError(401, 'Authentication required')
      const shop = await db.shop.findUnique({ where: { id: ctx.user.shopId } })
      if (!shop) return jsonError(404, 'Shop not found')

      const result = await initiateTransfer({
        scope: 'SHOP',
        shopId: shop.id,
        shopName: shop.name,
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
    const ctx = await requireAnyShopAdmin()
    const count = await cancelPendingTransfer({
      scope: 'SHOP',
      shopId: ctx.user.shopId,
      fromUserId: ctx.user.id,
      userId: ctx.user.id,
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, cancelled: count })
  })
}
