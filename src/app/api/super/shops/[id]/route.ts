// Activate / suspend a shop; reset owner password; DELETE (full offboard).
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getClientIp, bcryptHash, randomToken } from '@/lib/security'
import { storageDeletePrefix } from '@/lib/filestore'
import { z } from 'zod'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

// Full offboard: permanently removes a shop and every tenant-owned row.
// Explicit ordered deletes (same proven order as the ops cleanup script) so
// RESTRICT FKs (Document↔PrintJob) never abort mid-cascade; the Shop row is
// deleted last so remaining FKs (SubscriptionPayment, AuditLog→SetNull) resolve.
// Uploaded files under uploads/<shopId>/ are purged from storage afterwards.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const { id } = await params
    const body = z.object({ confirm: z.string().trim().min(1).max(80) }).parse(await req.json().catch(() => ({})))
    const shop = await db.shop.findUnique({ where: { id } })
    if (!shop) return jsonError(404, 'Shop not found')
    if (body.confirm !== shop.slug) {
      return jsonError(400, `Confirmation required: pass {"confirm":"${shop.slug}"} to permanently delete this shop`)
    }

    const users = await db.user.findMany({ where: { shopId: id }, select: { id: true } })
    const userIds = users.map((u) => u.id)

    // 19 sequential statements — on serverless + pooler each round-trip costs
    // latency, so raise the interactive-transaction timeout well past the 5s default.
    let counts: Record<string, number>
    try {
      counts = await db.$transaction(async (tx) => {
        const c: Record<string, number> = {}
        c.sessions = (await tx.session.updateMany({ where: { userId: { in: userIds } }, data: { revokedAt: new Date() } })).count
        c.printEvents = (await tx.printEvent.deleteMany({ where: { shopId: id } })).count
        c.printJobs = (await tx.printJob.deleteMany({ where: { shopId: id } })).count
        c.notifications = (await tx.notification.deleteMany({ where: { shopId: id } })).count
        c.paymentVerifications = (
          await tx.paymentVerification.deleteMany({ where: { paymentId: { in: (await tx.payment.findMany({ where: { shopId: id }, select: { id: true } })).map((p) => p.id) } } })
        ).count
        c.payments = (await tx.payment.deleteMany({ where: { shopId: id } })).count
        c.orderItems = (await tx.orderItem.deleteMany({ where: { shopId: id } })).count
        c.orders = (await tx.order.deleteMany({ where: { shopId: id } })).count
        c.documents = (await tx.document.deleteMany({ where: { shopId: id } })).count
        c.customerSessions = (await tx.customerSession.deleteMany({ where: { shopId: id } })).count
        c.printers = (await tx.printer.deleteMany({ where: { shopId: id } })).count
        c.devices = (await tx.device.deleteMany({ where: { shopId: id } })).count
        c.routingRules = (await tx.routingRule.deleteMany({ where: { shopId: id } })).count
        c.pricingRules = (await tx.pricingRule.deleteMany({ where: { shopId: id } })).count
        c.shopMembers = (await tx.shopMember.deleteMany({ where: { shopId: id } })).count
        c.subscriptionPayments = (await tx.subscriptionPayment.deleteMany({ where: { shopId: id } })).count
        c.subscriptions = (await tx.subscription.deleteMany({ where: { shopId: id } })).count
        c.users = (await tx.user.deleteMany({ where: { shopId: id } })).count
        await tx.shop.delete({ where: { id } })
        return c
      }, { maxWait: 15000, timeout: 60000 })
    } catch (err) {
      console.error('[super] shop delete failed:', err)
      // The platform owner needs the real reason (which step failed) — safe:
      // this route is super-admin-only and never exposes secret material.
      return jsonError(500, `Delete failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }

    // Storage is outside the DB transaction — purge after commit (best effort).
    const filesDeleted = await storageDeletePrefix(`uploads/${id}/`)

    await audit({
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SHOP_DELETED',
      entity: 'Shop',
      entityId: id,
      meta: { slug: shop.slug, name: shop.name, ...counts, filesDeleted },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, deleted: counts, filesDeleted })
  })
}
