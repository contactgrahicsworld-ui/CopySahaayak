// Create an order: server-side pricing, plan quota, dynamic UPI QR.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getCustomerSession } from '@/lib/auth'
import { createOrderSchema } from '@/lib/validation'
import { createOrder } from '@/lib/orders'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.createOrder, bucket: 'order' } },
    async () => {
      const { slug } = await params
      const shop = await db.shop.findUnique({ where: { slug } })
      if (!shop || !shop.isActive) return jsonError(404, 'Shop not found')
      const session = await getCustomerSession(shop.id)
      if (!session) return jsonError(401, 'Start a session first')

      const body = createOrderSchema.parse(await req.json())
      const order = await createOrder({
        shopId: shop.id,
        customerSessionId: session.id,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        notes: body.notes,
        items: body.items,
        ip: getClientIp(req),
      })
      const payment = await db.payment.findUnique({ where: { orderId: order.id } })
      let qrDataUrl: string | undefined
      if (payment) {
        const { generateUpiQr } = await import('@/lib/upi')
        const qr = await generateUpiQr(shop, order.totalPaise, order.orderNumber)
        qrDataUrl = qr.dataUrl
      }
      return jsonOk({
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalPaise: order.totalPaise,
        status: order.status,
        qrDataUrl,
        upi: payment
          ? { payload: payment.qrPayload, vpa: payment.upiVpa, payeeName: payment.payeeName, amountPaise: payment.amountPaise }
          : null,
      })
    }
  )
}
