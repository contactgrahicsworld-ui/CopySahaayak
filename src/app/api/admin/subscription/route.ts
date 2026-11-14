// Shop subscription: view current plan + submit renewal payment (UTR) for
// Super Admin verification. Activates only after manual verification — OR
// instantly when the gateway webhook (or the pull-based reconciliation below)
// confirms the gateway payment.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'
import { z } from 'zod'
import { settings } from '@/lib/settings'
import { getPlatformYoupiConfig } from '@/lib/youpi'
import { reconcileSubscriptionPaymentFromGateway } from '@/lib/gateway-reconcile'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    let subscription = await db.subscription.findUnique({
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

    // WEBHOOK-MISSED SAFETY NET: the shop paid via hosted checkout, was
    // redirected back, but the webhook hasn't landed. Ask the gateway directly
    // (throttled server-side to one call / payment / 20 s across all instances).
    let gatewayReconciled = false
    const openGatewayPayment = payments.find((p) => ['PENDING', 'REJECTED'].includes(p.status) && p.gatewayRef)
    if (openGatewayPayment) {
      const rec = await reconcileSubscriptionPaymentFromGateway(openGatewayPayment.id).catch(() => null)
      if (rec?.advanced) {
        gatewayReconciled = true
        const [freshSub, freshPayments] = await Promise.all([
          db.subscription.findUnique({ where: { shopId: ctx.user.shopId }, include: { plan: true } }),
          db.subscriptionPayment.findMany({
            where: { shopId: ctx.user.shopId },
            orderBy: { createdAt: 'desc' },
            take: 20,
            include: { plan: { select: { name: true, code: true } } },
          }),
        ])
        subscription = freshSub
        if (freshPayments) {
          payments.length = 0
          payments.push(...freshPayments)
        }
      }
    }

    const s = await settings.all()
    const gatewayCfg = await getPlatformYoupiConfig()
    return jsonOk(
      {
        // Authoritative server timestamp: the client clock can be wrong, so
        // countdowns anchor to this and tick locally (see PlanClock).
        serverNow: new Date().toISOString(),
        subscription,
        plans: plans.map((p) => ({ ...p, features: JSON.parse(p.featuresJson || '[]') })),
        payments,
        superAdminUpi: s.super_admin_upi_vpa || '',
        superAdminPayee: s.super_admin_payee_name || 'Platform',
        // Gateway available? The shop can pay the plan via YouPI checkout and
        // the signed webhook auto-activates the plan — no UTR wait.
        gatewayConfigured: Boolean(gatewayCfg),
        gatewayReconciled,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  })
}

const paySchema = z.object({
  // Not a hardcoded enum: the super admin controls which plans exist/are active,
  // so the code is validated against the DB right below.
  planCode: z.string().trim().regex(/^[A-Z]{2,20}$/),
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

// Cancel MY OWN open PENDING subscription payment. Without this, an abandoned
// gateway checkout or a UTR the super admin never got to would leave a PENDING
// row that blocks BOTH payment paths forever ("you already have a payment
// awaiting verification") — a permanent lockout. Only PENDING can be cancelled
// (verified/rejected rows are history), and only the owning shop can do it.
export async function DELETE(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    // Atomic conditional cancel: if a gateway webhook verifies the payment in
    // the same instant, the claim loses (count 0) and the money is honored —
    // a cancel can never race away a verified payment.
    const claim = await db.subscriptionPayment.updateMany({
      where: { shopId: ctx.user.shopId, status: 'PENDING' },
      data: { status: 'REJECTED', rejectionReason: 'Cancelled by shop (payment not completed)' },
    })
    if (claim.count === 0) {
      return jsonError(409, 'Koi open payment cancel karne ko nahi hai (already verified/rejected)')
    }
    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SUBSCRIPTION_PAYMENT_CANCELLED',
      entity: 'SubscriptionPayment',
      entityId: '-',
      meta: { by: ctx.user.email },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}
