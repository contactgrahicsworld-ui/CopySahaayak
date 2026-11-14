// Customer pays an order through the shop's YouPI PG gateway session.
// Server-side session creation: the shop's merchant API key NEVER reaches the
// browser — the customer only receives the hosted checkoutUrl.
//   POST {} → { checkoutUrl, gatewayPaymentId }
// Requirements: shop gateway enabled + platform gateway URL configured, order
// in PENDING_PAYMENT owned by this customer session. Idempotent: the same
// payment id always maps to the same gateway session (Idempotency-Key).
import { db, retryDb } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getCustomerSession } from '@/lib/auth'
import { getShopYoupiConfig, createGatewaySession } from '@/lib/youpi'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; orderNumber: string }> }) {
  return handleRoute(req, { rateLimit: { max: 6, windowMs: 5 * 60_000, bucket: 'gw-session' } }, async () => {
    const { slug, orderNumber } = await params
    const shop = await db.shop.findUnique({ where: { slug } })
    if (!shop || !shop.isActive) return jsonError(404, 'Shop not found')
    const session = await getCustomerSession(shop.id)
    if (!session) return jsonError(401, 'Session required')

    const order = await db.order.findUnique({ where: { orderNumber } })
    if (!order || order.shopId !== shop.id || order.customerSessionId !== session.id) {
      return jsonError(404, 'Order not found')
    }
    if (order.status !== 'PENDING_PAYMENT') return jsonError(409, `Order is already ${order.status.toLowerCase().replace('_', ' ')}`)

    const payment = await retryDb(() => db.payment.findUnique({ where: { orderId: order.id } }))
    if (!payment) return jsonError(500, 'Order payment row missing')

    const cfg = await getShopYoupiConfig(shop.id)
    if (!cfg) return jsonError(409, 'Is shop ke liye online gateway abhi available nahi hai — UPI QR se pay karein')

    const origin = new URL(req.url).origin
    const created = await createGatewaySession(cfg, {
      orderId: `ORD-${payment.id}`,
      amountPaise: payment.amountPaise,
      description: `${shop.name} — Order ${order.orderNumber}`,
      returnUrl: `${origin}/s/${slug}/order/${orderNumber}`,
      idempotencyKey: `ordpay-${payment.id}`,
    })

    if (payment.gatewayRef !== created.paymentId) {
      await retryDb(() => db.payment.update({ where: { id: payment.id }, data: { gatewayRef: created.paymentId } }))
    }
    await audit({
      shopId: shop.id,
      actorType: 'CUSTOMER',
      actorId: session.id,
      action: 'GATEWAY_SESSION_CREATED',
      entity: 'Payment',
      entityId: payment.id,
      meta: { orderNumber: order.orderNumber, gatewayRef: created.paymentId, amountPaise: payment.amountPaise },
      ip: getClientIp(req),
    })
    return jsonOk({ checkoutUrl: created.checkoutUrl, gatewayPaymentId: created.paymentId })
  })
}
