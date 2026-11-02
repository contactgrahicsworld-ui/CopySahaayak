// Shop admin dashboard stats.
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [pendingOrders, awaitingVerification, confirmed, completedToday, revenueToday, revenueMonth, onlinePrinters, totalPrinters, activeJobs, subscription] =
      await Promise.all([
        db.order.count({ where: { shopId, status: 'PENDING_PAYMENT' } }),
        db.order.count({ where: { shopId, status: 'AWAITING_VERIFICATION' } }),
        db.order.count({ where: { shopId, status: 'CONFIRMED' } }),
        db.order.count({ where: { shopId, status: 'COMPLETED', completedAt: { gte: todayStart } } }),
        db.payment.aggregate({ where: { shopId, status: 'VERIFIED', verifiedAt: { gte: todayStart } }, _sum: { amountPaise: true } }),
        db.payment.aggregate({ where: { shopId, status: 'VERIFIED', verifiedAt: { gte: monthStart } }, _sum: { amountPaise: true } }),
        db.printer.count({ where: { shopId, status: 'ONLINE' } }),
        db.printer.count({ where: { shopId } }),
        db.printJob.count({ where: { shopId, status: { in: ['QUEUED', 'CLAIMED', 'SPOOLING'] } } }),
        db.subscription.findUnique({ where: { shopId }, include: { plan: true } }),
      ])

    return jsonOk({
      orders: { pendingOrders, awaitingVerification, confirmed, completedToday, activeJobs },
      revenue: { todayPaise: revenueToday._sum.amountPaise || 0, monthPaise: revenueMonth._sum.amountPaise || 0 },
      printers: { online: onlinePrinters, total: totalPrinters },
      subscription,
    })
  })
}
