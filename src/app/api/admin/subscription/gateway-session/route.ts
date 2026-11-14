// Shop owner pays the platform subscription through the YouPI gateway.
//   POST {planCode} → { checkoutUrl, gatewayPaymentId }
// The platform-level merchant receives this money; verification arrives via
// the signed webhook (RECONCILED / opted-in OBSERVED_SUCCESS) which
// auto-activates the plan — no super-admin UTR checking needed. Manual UTR
// flow stays available as fallback.
import { db, retryDb } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { z } from 'zod'
import { getPlatformYoupiConfig, createGatewaySession } from '@/lib/youpi'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const bodySchema = z.object({ planCode: z.string().trim().regex(/^[A-Z]{2,20}$/) })

export async function POST(req: Request) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.pairing, bucket: 'gw-sub' } }, async () => {
    const ctx = await requireAnyShopAdmin()
    const body = bodySchema.parse(await req.json().catch(() => ({})))
    const plan = await db.plan.findUnique({ where: { code: body.planCode } })
    if (!plan || !plan.isActive) return jsonError(404, 'Plan not found')

    const existing = await db.subscriptionPayment.findFirst({ where: { shopId: ctx.user.shopId, status: 'PENDING' } })
    if (existing) return jsonError(409, 'Aapki ek payment pehle se verification me hai')

    const cfg = await getPlatformYoupiConfig()
    if (!cfg) return jsonError(409, 'Platform gateway configured nahi hai — UTR wala manual tarika use karein')

    const payment = await retryDb(() =>
      db.subscriptionPayment.create({
        data: { shopId: ctx.user.shopId, planId: plan.id, amountPaise: plan.pricePaise, utr: null, status: 'PENDING' },
      })
    )

    try {
      const origin = new URL(req.url).origin
      const created = await createGatewaySession(cfg, {
        orderId: `SUB-${payment.id}`,
        amountPaise: plan.pricePaise,
        description: `CopySahaayak ${plan.name} plan`,
        returnUrl: `${origin}/admin`,
        idempotencyKey: `subpay-${payment.id}`,
      })
      await retryDb(() => db.subscriptionPayment.update({ where: { id: payment.id }, data: { gatewayRef: created.paymentId } }))
      await retryDb(() =>
        db.notification.create({
          data: { audience: 'SUPER', shopId: ctx.user.shopId, title: 'Subscription payment via gateway', body: `${plan.name} plan — gateway session opened (${created.paymentId})` },
        })
      )
      await audit({
        shopId: ctx.user.shopId,
        userId: ctx.user.id,
        actorType: 'USER',
        action: 'GATEWAY_SUB_SESSION_CREATED',
        entity: 'SubscriptionPayment',
        entityId: payment.id,
        meta: { planCode: plan.code, gatewayRef: created.paymentId, amountPaise: plan.pricePaise },
        ip: getClientIp(req),
      })
      return jsonOk({ checkoutUrl: created.checkoutUrl, gatewayPaymentId: created.paymentId })
    } catch (err) {
      // Session creation failed — do not leave a stuck PENDING row blocking the manual flow.
      await retryDb(() => db.subscriptionPayment.delete({ where: { id: payment.id } }).catch(() => null))
      throw err
    }
  })
}
