// Customer order tracking. Access rules (IDOR protection): the guest session
// that created the order, OR the matching customer phone number.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getCustomerSession } from '@/lib/auth'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { reconcileOrderPaymentFromGateway } from '@/lib/gateway-reconcile'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; orderNumber: string }> }) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'track' }, checkOrigin: false }, async () => {
    const { slug, orderNumber } = await params
    const shop = await db.shop.findUnique({ where: { slug } })
    if (!shop) return jsonError(404, 'Shop not found')

    const order = await db.order.findUnique({
      where: { orderNumber },
      include: {
        items: {
          include: {
            document: { select: { originalName: true, pageCount: true } },
            printJobs: { select: { id: true, status: true } },
          },
        },
        payment: { select: { id: true, status: true, utr: true, rejectionReason: true, amountPaise: true, upiVpa: true, payeeName: true, qrPayload: true, gatewayRef: true, gatewayCheckedAt: true, verifiedVia: true } },
      },
    })
    if (!order || order.shopId !== shop.id) return jsonError(404, 'Order not found')

    const session = await getCustomerSession(shop.id)
    const url = new URL(req.url)
    const phone = url.searchParams.get('phone')
    const authorized =
      (session && order.customerSessionId === session.id) ||
      (order.customerPhone && phone && order.customerPhone.replace(/\D/g, '') === phone.replace(/\D/g, ''))
    if (!authorized) return jsonError(403, 'Not authorized to view this order')

    // WEBHOOK-MISSED SAFETY NET: if a hosted checkout session was opened for
    // this order and no signed webhook has confirmed it yet, ask the gateway
    // directly (throttled server-side; this page polls every 8 s). Never
    // blocks the response — all reconcile errors are swallowed inside.
    let gatewayReconciled = false
    let payment = order.payment ? { ...order.payment } : null
    let orderStatus = order.status
    const paymentId = order.payment?.id
    if (payment && paymentId && ['PENDING', 'SUBMITTED'].includes(payment.status) && payment.gatewayRef) {
      const rec = await reconcileOrderPaymentFromGateway(paymentId).catch(() => null)
      if (rec?.advanced) {
        gatewayReconciled = true
        const fresh = await db.payment.findUnique({
          where: { id: paymentId },
          select: { status: true, utr: true, rejectionReason: true, amountPaise: true, upiVpa: true, payeeName: true, qrPayload: true, verifiedVia: true, order: { select: { status: true } } },
        })
        if (fresh) {
          const { order: freshOrder, ...freshPayment } = fresh
          payment = { ...payment, ...freshPayment }
          orderStatus = freshOrder.status
        }
      }
    }
    // Internal gateway bookkeeping fields never leave the server.
    const paymentPublic = payment
      ? {
          status: payment.status,
          utr: payment.utr,
          rejectionReason: payment.rejectionReason,
          amountPaise: payment.amountPaise,
          upiVpa: payment.upiVpa,
          payeeName: payment.payeeName,
          qrPayload: payment.qrPayload,
          verifiedVia: payment.verifiedVia ?? null,
        }
      : null

    return jsonOk({
      orderNumber: order.orderNumber,
      status: orderStatus,
      totalPaise: order.totalPaise,
      createdAt: order.createdAt,
      customerName: order.customerName,
      items: order.items.map((i) => ({
        id: i.id,
        fileName: i.document.originalName,
        pageCount: i.pageCount,
        colorMode: i.colorMode,
        paperSize: i.paperSize,
        duplex: i.duplex,
        copies: i.copies,
        totalPaise: i.totalPaise,
        printJobs: i.printJobs.map((j) => ({ id: j.id, status: j.status })),
      })),
      payment: paymentPublic,
      gatewayReconciled,
    })
  })
}
