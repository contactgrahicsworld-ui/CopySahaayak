// Owner self-service downgrade: move this shop back to the 7-day TRIAL plan
// immediately. Payment history is preserved; a pending UTR payment blocks the
// downgrade so the platform admin's verification flow stays unambiguous.
// Downgrading only tightens limits going forward — it never touches existing
// orders, devices or printers. (Trial model: no permanent free tier — after the
// 7 trial days the shop must pick a paid plan to keep receiving orders.)
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

    // Pending-payment check FIRST: a shop still on the TRIAL plan that has just
    // submitted its first UTR must be told to wait (409), not "already on Trial".
    const pending = await db.subscriptionPayment.findFirst({
      where: { shopId: ctx.user.shopId, status: 'PENDING' },
    })
    if (pending) {
      return jsonError(
        409,
        'You have a payment awaiting verification. Wait for the platform admin to verify or reject it first.'
      )
    }

    if (sub.plan.code === 'TRIAL') return jsonError(400, 'You are already on the Trial plan')

    const trialPlan = await db.plan.findUnique({ where: { code: 'TRIAL' } })
    if (!trialPlan) return jsonError(500, 'Trial plan is not configured')

    const now = new Date()
    await db.subscription.update({
      where: { shopId: ctx.user.shopId },
      data: {
        planId: trialPlan.id,
        status: 'ACTIVE',
        startsAt: sub.startsAt ?? now,
        expiresAt: new Date(now.getTime() + trialPlan.durationDays * 86400_000),
      },
    })

    await db.notification.create({
      data: {
        audience: 'SUPER',
        shopId: ctx.user.shopId,
        title: 'Shop moved to the Trial plan',
        body: `${sub.plan.name} → Trial 7-day (self-service downgrade)`,
      },
    })

    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SUBSCRIPTION_DOWNGRADED',
      entity: 'Subscription',
      entityId: sub.id,
      meta: { fromPlanCode: sub.plan.code, toPlanCode: 'TRIAL' },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, planCode: 'TRIAL' })
  })
}
