// Shop subscription: view current plan + submit renewal payment (UTR) for
// Super Admin verification. Activates only after manual verification.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'
import { z } from 'zod'
import { settings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const subscription = await db.subscription.findUnique({
      where: { shopId: ctx.user.shopId },
      include: { plan: true },
    })
    const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } })
    const payments = await db.subscriptionPayment.findMany({
      where: { shopId: ctx.user.shopId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { plan: { select: { name: true, code: true } } },
    })
    const s = await settings.all()
    return jsonOk({
      subscription,
      plans: plans.map((p) => ({ ...p, features: JSON.parse(p.featuresJson || '[]') })),
      payments,
      superAdminUpi: s.super_admin_upi_vpa || '',
      superAdminPayee: s.super_admin_payee_name || 'Platform',
    })
  })
}

const paySchema = z.object({
  planCode: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']),
  utr: z.string().trim().regex(/^[a-zA-Z0-9]{8,22}$/),
  payerName: z.string().trim().max(60).optional(),
})

export async function POST(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const body = paySchema.parse(await req.json())
    const plan = await db.plan.findUnique({ where: { code: body.planCode } })
    if (!plan || !plan.isActive) return jsonError(404, 'Plan not found')

    const existing = await db.subscriptionPayment.findFirst({
      where: { shopId: ctx.user.shopId, status: 'PENDING' },
    })
    if (existing) return jsonError(409, 'You already have a payment awaiting verification')

    const payment = await db.subscriptionPayment.create({
      data: {
        shopId: ctx.user.shopId,
        planId: plan.id,
        amountPaise: plan.pricePaise,
        utr: body.utr,
        payerName: body.payerName || null,
        status: 'PENDING',
      },
    })
    await db.notification.create({
      data: {
        audience: 'SUPER',
        shopId: ctx.user.shopId,
        title: 'Subscription payment submitted',
        body: `${plan.name} plan — UTR ${body.utr}`,
      },
    })
    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SUBSCRIPTION_PAYMENT_SUBMITTED',
      entity: 'SubscriptionPayment',
      entityId: payment.id,
      meta: { planCode: plan.code, utr: body.utr },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, paymentId: payment.id })
  })
}
