// Activate / suspend a shop; reset owner password.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getClientIp, bcryptHash, randomToken } from '@/lib/security'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  action: z.enum(['ACTIVATE', 'SUSPEND', 'RESET_PASSWORD', 'REVOKE_ALL_DEVICES']),
  reason: z.string().trim().max(300).optional(),
  newPassword: z.string().min(8).max(100).optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const { id } = await params
    const body = patchSchema.parse(await req.json())
    const shop = await db.shop.findUnique({ where: { id } })
    if (!shop) return jsonError(404, 'Shop not found')

    switch (body.action) {
      case 'ACTIVATE':
        await db.shop.update({ where: { id }, data: { isActive: true, suspendedReason: null } })
        break
      case 'SUSPEND':
        await db.shop.update({ where: { id }, data: { isActive: false, suspendedReason: body.reason || 'Suspended by platform admin' } })
        await db.device.updateMany({ where: { shopId: id, status: 'ACTIVE' }, data: { status: 'REVOKED', tokenHash: null } })
        await db.printer.updateMany({ where: { shopId: id }, data: { status: 'OFFLINE' } })
        break
      case 'RESET_PASSWORD': {
        const newPass = body.newPassword || randomToken(9)
        await db.user.updateMany({ where: { shopId: id, role: 'SHOP_ADMIN' }, data: { passwordHash: await bcryptHash(newPass) } })
        await db.session.updateMany({ where: { user: { shopId: id } }, data: { revokedAt: new Date() } })
        await audit({
          shopId: id,
          userId: ctx.user.id,
          actorType: 'USER',
          action: 'SHOP_ADMIN_PASSWORD_RESET',
          entity: 'Shop',
          entityId: id,
          ip: getClientIp(req),
        })
        return jsonOk({ ok: true, newPassword: newPass })
      }
      case 'REVOKE_ALL_DEVICES':
        await db.device.updateMany({ where: { shopId: id, status: { in: ['ACTIVE', 'PENDING'] } }, data: { status: 'REVOKED', tokenHash: null, pairingCode: null } })
        await db.printer.updateMany({ where: { shopId: id }, data: { status: 'OFFLINE', deviceId: null } })
        break
    }
    await audit({
      shopId: id,
      userId: ctx.user.id,
      actorType: 'USER',
      action: `SHOP_${body.action}`,
      entity: 'Shop',
      entityId: id,
      meta: { reason: body.reason },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}
