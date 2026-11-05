// Subscription payments: queue + verify/reject. VERIFY activates/extends the
// shop subscription. Never auto-approves; audit-logged.
import { db, TX } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { verifyPaymentActionSchema } from '@/lib/validation'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const url = new URL(req.url)
    const status = url.searchParams.get('status') || 'PENDING'
    const payments = await db.subscriptionPayment.findMany({
      where: status !== 'ALL' ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        shop: { select: { id: true, name: true, slug: true, phone: true } },
        plan: { select: { name: true, code: true, pricePaise: true, durationDays: true } },
      },
    })
    return jsonOk({ payments })
  })
}

export async function POST(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return jsonError(400, 'Payment id required (?id=)')
    const body = verifyPaymentActionSchema.parse(await req.json())

    const payment = await db.subscriptionPayment.findUnique({ where: { id }, include: { plan: true, shop: true } })
    if (!payment) return jsonError(404, 'Payment not found')
    if (payment.status !== 'PENDING') return jsonError(409, 'Payment already processed')

    if (body.action === 'VERIFY') {
      await db.$transaction(async (tx) => {
        await tx.subscriptionPayment.update({
          where: { id },
          data: { status: 'VERIFIED', verifiedByUserId: ctx.user.id, verifiedAt: new Date(), notes: body.note || null },
        })
        // Activate / extend the subscription
        const existing = await tx.subscription.findUnique({ where: { shopId: payment.shopId } })
        const base = existing?.expiresAt && existing.expiresAt > new Date() ? existing.expiresAt : new Date()
        const expiresAt = new Date(base.getTime() + payment.plan.durationDays * 86400000)
        if (existing) {
          await tx.subscription.update({
            where: { shopId: payment.shopId },
            data: { planId: payment.planId, status: 'ACTIVE', startsAt: existing.startsAt || new Date(), expiresAt },
          })
        } else {
          await tx.subscription.create({
            data: { shopId: payment.shopId, planId: payment.planId, status: 'ACTIVE', startsAt: new Date(), expiresAt },
          })
        }
        await tx.shop.update({ where: { id: payment.shopId }, data: { isActive: true } })
        await tx.notification.create({
          data: { shopId: payment.shopId, audience: 'SHOP', title: `${payment.plan.name} plan activated`, body: `Valid until ${expiresAt.toLocaleDateString('en-IN')}` },
        })
      }, TX)
    } else {
      await db.$transaction(async (tx) => {
        await tx.subscriptionPayment.update({
          where: { id },
          data: { status: 'REJECTED', verifiedByUserId: ctx.user.id, verifiedAt: new Date(), rejectionReason: body.note || 'UTR not found' },
        })
        await tx.notification.create({
          data: { shopId: payment.shopId, audience: 'SHOP', title: 'Subscription payment rejected', body: body.note || 'UTR not found — please re-check and resubmit' },
        })
      }, TX)
    }
    await audit({
      shopId: payment.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: body.action === 'VERIFY' ? 'SUBSCRIPTION_VERIFIED' : 'SUBSCRIPTION_REJECTED',
      entity: 'SubscriptionPayment',
      entityId: id,
      meta: { planCode: payment.plan.code, utr: payment.utr, note: body.note },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, action: body.action })
  })
}
