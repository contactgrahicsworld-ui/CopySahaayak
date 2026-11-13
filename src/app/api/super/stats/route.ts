// Super admin PLATFORM analytics — tenant-isolated.
// Owner requirement: the platform admin must NOT see shops' business data
// (orders, customer payments/GMV). Everything here is platform-own data:
// shop accounts (counts/plan/status), subscription revenue, devices, storage.
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

    const [shops, activeShops, suspended, revenueAll, revenueMonth, pendingSubPayments, activeSubs, devices, onlineDevices, storageAgg] =
      await Promise.all([
        db.shop.count(),
        db.shop.count({ where: { isActive: true } }),
        db.shop.count({ where: { isActive: false } }),
        db.subscriptionPayment.aggregate({ where: { status: 'VERIFIED' }, _sum: { amountPaise: true } }),
        db.subscriptionPayment.aggregate({ where: { status: 'VERIFIED', verifiedAt: { gte: monthStart } }, _sum: { amountPaise: true } }),
        db.subscriptionPayment.count({ where: { status: 'PENDING' } }),
        db.subscription.count({ where: { status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
        db.device.count({ where: { status: { in: ['PENDING', 'ACTIVE'] } } }),
        db.device.count({ where: { status: 'ACTIVE', lastSeenAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } }),
        db.document.aggregate({ where: { status: 'READY' }, _sum: { sizeBytes: true }, _count: true }),
      ])

    // Plan distribution
    const planDist = await db.subscription.groupBy({ by: ['planId', 'status'], _count: true, where: { status: 'ACTIVE' } })
    const plans = await db.plan.findMany()
    const planDistOut = planDist.map((p) => ({
      plan: plans.find((pl) => pl.id === p.planId)?.name || 'Unknown',
      count: p._count,
    }))

    // Subscription revenue trend (platform's OWN income — never shops' GMV)
    const recentSubs = await db.subscriptionPayment.findMany({
      where: { status: 'VERIFIED', verifiedAt: { gte: new Date(Date.now() - 14 * 86400000) } },
      select: { verifiedAt: true, amountPaise: true },
    })
    const byDay = new Map<string, number>()
    for (const p of recentSubs) {
      const key = (p.verifiedAt || new Date()).toISOString().slice(0, 10)
      byDay.set(key, (byDay.get(key) || 0) + p.amountPaise)
    }
    const subRevenueDaily = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, paise]) => ({ date, paise }))

    return jsonOk({
      shops: { total: shops, active: activeShops, suspended },
      revenue: {
        subscriptionAllPaise: revenueAll._sum.amountPaise || 0,
        subscriptionMonthPaise: revenueMonth._sum.amountPaise || 0,
      },
      pending: { subscriptionPayments: pendingSubPayments },
      subscriptions: { active: activeSubs, planDistribution: planDistOut },
      devices: { registered: devices, onlineNow: onlineDevices },
      storage: { totalBytes: storageAgg._sum.sizeBytes || 0, documents: storageAgg._count },
      subRevenueDaily,
    })
  })
}
