// Shop order list with filters. Tenant-scoped: only this shop's orders.
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const url = new URL(req.url)
    const status = url.searchParams.get('status')
    const q = url.searchParams.get('q')?.trim()
    const take = Math.min(Number(url.searchParams.get('take') || 60), 200)

    const orders = await db.order.findMany({
      where: {
        shopId,
        ...(status && status !== 'ALL' ? { status } : {}),
        ...(q ? { OR: [{ orderNumber: { contains: q } }, { customerPhone: { contains: q } }, { customerName: { contains: q } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        payment: { select: { status: true, utr: true, amountPaise: true, verifiedAt: true, rejectionReason: true } },
        items: {
          select: {
            id: true,
            colorMode: true,
            paperSize: true,
            copies: true,
            duplex: true,
            pageCount: true,
            totalPaise: true,
            document: { select: { id: true, originalName: true } },
          },
        },
        printJobs: { select: { id: true, status: true } },
      },
    })
    return jsonOk({ orders })
  })
}
