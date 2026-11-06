// Owner self-service downgrade: move this shop back to the Free plan immediately.
// Payment history is preserved; a pending UTR payment blocks the downgrade so the
// platform admin's verification flow stays unambiguous. Downgrading only tightens
// limits going forward — it never touches existing orders, devices or printers.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const sub = await db.subscription.findUnique({
      where: { shopId: ctx.user.shopId },
      include: { plan: true },
    })
    if (!sub) return jsonError(404, 'No subscription found')

    // Pending-payment check FIRST: a shop still on the FREE plan that has just
    // submitted its first UTR must be told to wait (409), not "already on Free".
    const pending = await db.subscriptionPayment.findFirst({
      where: { shopId: ctx.user.shopId, status: 'PENDING' },
    })
    if (pending) {
      return jsonError(
        409,
        'You have a payment awaiting verification. Wait for the platform admin to verify or reject it first.'
      )
    }

    if (sub.plan.code === 'FREE') return jsonError(400, 'You are already on the Free plan')

    const freePlan = await db.plan.findUnique({ where: { code: 'FREE' } })
    if (!freePlan) return jsonError(500, 'Free plan is not configured')

    const now = new Date()
    await db.subscription.update({
      where: { shopId: ctx.user.shopId },
      data: {
        planId: freePlan.id,
        status: 'ACTIVE',
        startsAt: sub.startsAt ?? now,
        expiresAt: new Date(now.getTime() + freePlan.durationDays * 86400_000),
      },
    })

    await db.notification.create({
      data: {
        audience: 'SUPER',
        shopId: ctx.user.shopId,
        title: 'Shop moved to the Free plan',
        body: `${sub.plan.name} → Free (self-service downgrade)`,
      },
    })

    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SUBSCRIPTION_DOWNGRADED',
      entity: 'Subscription',
      entityId: sub.id,
      meta: { fromPlanCode: sub.plan.code, toPlanCode: 'FREE' },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, planCode: 'FREE' })
  })
}
