// Pending payment verifications for the shop (UTR list + evidence).
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const url = new URL(req.url)
    const status = url.searchParams.get('status') || 'ACTION'

    // ACTION = everything the shop can act on right now: PENDING (no UTR —
    // accept on cash/direct UPI) + SUBMITTED (UTR waiting to be verified).
    const where =
      status === 'ALL'
        ? { shopId }
        : status === 'ACTION'
          ? { shopId, status: { in: ['PENDING', 'SUBMITTED'] } }
          : { shopId, status }

    const payments = await db.payment.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      take: 100,
      include: {
        order: {
          select: { orderNumber: true, totalPaise: true, customerName: true, customerPhone: true, items: { select: { colorMode: true, paperSize: true, copies: true, pageCount: true } } },
        },
        verifications: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    })
    return jsonOk({ payments })
  })
}
