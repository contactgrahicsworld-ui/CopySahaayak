// Customer order tracking. Access rules (IDOR protection): the guest session
// that created the order, OR the matching customer phone number.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getCustomerSession } from '@/lib/auth'
import { RATE_LIMITS } from '@/lib/rate-limit'

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
        payment: { select: { status: true, utr: true, rejectionReason: true, amountPaise: true, upiVpa: true, payeeName: true, qrPayload: true } },
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

    return jsonOk({
      orderNumber: order.orderNumber,
      status: order.status,
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
      payment: order.payment,
    })
  })
}
