// Sales reports: daily revenue + order counts + colour/side breakdown.
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const url = new URL(req.url)
    const days = Math.min(Math.max(Number(url.searchParams.get('days') || 30), 7), 90)
    const since = new Date(Date.now() - days * 86400000)

    const orders = await db.order.findMany({
      where: { shopId, createdAt: { gte: since }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
      select: {
        createdAt: true,
        totalPaise: true,
        status: true,
        items: { select: { colorMode: true, paperSize: true, pageCount: true, copies: true, totalPaise: true } },
      },
    })

    // Aggregate by day
    const byDay = new Map<string, { revenuePaise: number; orders: number }>()
    let bwSides = 0
    let colorSides = 0
    let bwRevenue = 0
    let colorRevenue = 0
    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 10)
      const cur = byDay.get(key) || { revenuePaise: 0, orders: 0 }
      cur.revenuePaise += o.totalPaise
      cur.orders += 1
      byDay.set(key, cur)
      for (const item of o.items) {
        const sides = item.pageCount * item.copies
        if (item.colorMode === 'BW') {
          bwSides += sides
          bwRevenue += item.totalPaise
        } else {
          colorSides += sides
          colorRevenue += item.totalPaise
        }
      }
    }
    const daily = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }))

    const statusCounts = await db.order.groupBy({ by: ['status'], where: { shopId, createdAt: { gte: since } }, _count: true })

    return jsonOk({
      rangeDays: days,
      daily,
      summary: {
        totalRevenuePaise: daily.reduce((s, d) => s + d.revenuePaise, 0),
        totalOrders: daily.reduce((s, d) => s + d.orders, 0),
        bwSides,
        colorSides,
        bwRevenuePaise: bwRevenue,
        colorRevenuePaise: colorRevenue,
      },
      statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count })),
    })
  })
}
