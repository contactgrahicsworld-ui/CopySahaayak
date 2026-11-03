// Super admin platform analytics.
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireSuper } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const [shops, activeShops, suspended, orders, ordersMonth, revenueAll, revenueMonth, pendingSubPayments, activeSubs, devices, onlineDevices, storageAgg, pendingShopPayments] =
      await Promise.all([
        db.shop.count(),
        db.shop.count({ where: { isActive: true } }),
        db.shop.count({ where: { isActive: false } }),
        db.order.count(),
        db.order.count({ where: { createdAt: { gte: monthStart } } }),
        db.subscriptionPayment.aggregate({ where: { status: 'VERIFIED' }, _sum: { amountPaise: true } }),
        db.subscriptionPayment.aggregate({ where: { status: 'VERIFIED', verifiedAt: { gte: monthStart } }, _sum: { amountPaise: true } }),
        db.subscriptionPayment.count({ where: { status: 'PENDING' } }),
        db.subscription.count({ where: { status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
        db.device.count({ where: { status: { in: ['PENDING', 'ACTIVE'] } } }),
        db.device.count({ where: { status: 'ACTIVE', lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } }),
        db.document.aggregate({ where: { status: 'READY' }, _sum: { sizeBytes: true }, _count: true }),
        db.payment.count({ where: { status: 'SUBMITTED' } }),
      ])

    // Plan distribution
    const planDist = await db.subscription.groupBy({ by: ['planId', 'status'], _count: true, where: { status: 'ACTIVE' } })
    const plans = await db.plan.findMany()
    const planDistOut = planDist.map((p) => ({
      plan: plans.find((pl) => pl.id === p.planId)?.name || 'Unknown',
      count: p._count,
    }))

    // Last 14 days of platform GMV (verified shop payments)
    const recent = await db.payment.findMany({
      where: { status: 'VERIFIED', verifiedAt: { gte: new Date(Date.now() - 14 * 86400000) } },
      select: { verifiedAt: true, createdAt: true, amountPaise: true },
    })
    const byDay = new Map<string, number>()
    for (const p of recent) {
      const key = (p.verifiedAt || p.createdAt).toISOString().slice(0, 10)
      byDay.set(key, (byDay.get(key) || 0) + p.amountPaise)
    }
    const gmvDaily = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, paise]) => ({ date, paise }))

    return jsonOk({
      shops: { total: shops, active: activeShops, suspended },
      orders: { total: orders, thisMonth: ordersMonth },
      revenue: {
        subscriptionAllPaise: revenueAll._sum.amountPaise || 0,
        subscriptionMonthPaise: revenueMonth._sum.amountPaise || 0,
      },
      pending: { subscriptionPayments: pendingSubPayments, shopPayments: pendingShopPayments },
      subscriptions: { active: activeSubs, planDistribution: planDistOut },
      devices: { registered: devices, onlineNow: onlineDevices },
      storage: { totalBytes: storageAgg._sum.sizeBytes || 0, documents: storageAgg._count },
      gmvDaily,
    })
  })
}
