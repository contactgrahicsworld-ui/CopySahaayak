// Customer submits their own UPI ID when a refund is due on their order.
//   POST { vpa, phone? } → { ok }
// Access mirrors the order-tracker rule: the guest session that created the
// order, OR the matching customer phone number. The shop is notified with the
// VPA + a one-tap prefilled pay link appears on its refund card.
import { db, retryDb } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getCustomerSession } from '@/lib/auth'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// Conservative UPI VPA check: name@bank, no spaces/quotes.
const bodySchema = z.object({
  vpa: z.string().trim().regex(/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/),
  phone: z.string().trim().max(20).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; orderNumber: string }> }) {
  return handleRoute(req, { rateLimit: { max: 6, windowMs: 10 * 60_000, bucket: 'refund-contact' } }, async () => {
    const { slug, orderNumber } = await params
    const shop = await db.shop.findUnique({ where: { slug } })
    if (!shop || !shop.isActive) return jsonError(404, 'Shop not found')

    const order = await db.order.findUnique({ where: { orderNumber } })
    if (!order || order.shopId !== shop.id) return jsonError(404, 'Order not found')

    const session = await getCustomerSession(shop.id)
    const body = bodySchema.parse(await req.json().catch(() => ({})))
    const authorized =
      (session && order.customerSessionId === session.id) ||
      (order.customerPhone && body.phone && order.customerPhone.replace(/\D/g, '') === body.phone.replace(/\D/g, ''))
    if (!authorized) return jsonError(403, 'Not authorized for this order')

    const payment = await retryDb(() => db.payment.findUnique({ where: { orderId: order.id }, select: { id: true, status: true, refundVpa: true } }))
    if (!payment) return jsonError(404, 'Payment not found')
    if (payment.status === 'REFUNDED') return jsonError(409, 'Refund already done')

    if (payment.refundVpa !== body.vpa) {
      await retryDb(() => db.payment.update({ where: { id: payment.id }, data: { refundVpa: body.vpa } }))
      await retryDb(() =>
        db.notification
          .create({
            data: {
              shopId: shop.id,
              audience: 'SHOP',
              title: `Customer ka refund UPI mil gaya — ${orderNumber}`,
              body: `${body.vpa} par ₹${(order.totalPaise / 100).toFixed(2)} wapas karein (payments tab me one-tap link hai), phir "Refunded" mark karein.`,
            },
          })
          .catch(() => null)
      )
    }
    return jsonOk({ ok: true })
  })
}
