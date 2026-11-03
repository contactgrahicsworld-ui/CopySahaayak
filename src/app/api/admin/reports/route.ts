// Sales reports: revenue by day/week/month + colour/side breakdown +
// paper-size usage + machine-wise print counts. Powers the Reports tab and
// the Excel export endpoint. Tenant-scoped to the signed-in shop admin.
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { bucketKey, parseBucket, type Bucket } from '@/lib/reports'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const url = new URL(req.url)
    const days = Math.min(Math.max(Number(url.searchParams.get('days') || 30), 7), 365)
    const bucket: Bucket = parseBucket(url.searchParams.get('groupBy'))
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

    // Revenue buckets
    const byBucket = new Map<string, { revenuePaise: number; orders: number }>()
    let bwSides = 0, colorSides = 0, bwRevenue = 0, colorRevenue = 0
    // Paper usage: paperSize × colorMode → sides + sheets + revenue
    const paperMap = new Map<string, { sides: number; sheets: number; revenuePaise: number }>()
    for (const o of orders) {
      const key = bucketKey(o.createdAt, bucket)
      const cur = byBucket.get(key) || { revenuePaise: 0, orders: 0 }
      cur.revenuePaise += o.totalPaise
      cur.orders += 1
      byBucket.set(key, cur)
      for (const item of o.items) {
        const sides = item.pageCount * item.copies
        const sheets = Math.ceil(sides / (item.duplex ? 2 : 1))
        if (item.colorMode === 'BW') {
          bwSides += sides
          bwRevenue += item.totalPaise
        } else {
          colorSides += sides
          colorRevenue += item.totalPaise
        }
        const pk = `${item.paperSize}|${item.colorMode}`
        const p = paperMap.get(pk) || { sides: 0, sheets: 0, revenuePaise: 0 }
        p.sides += sides
        p.sheets += sheets
        p.revenuePaise += item.totalPaise
        paperMap.set(pk, p)
      }
    }
    const series = Array.from(byBucket.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, v]) => ({ period, ...v }))

    const paper = Array.from(paperMap.entries())
      .map(([k, v]) => {
        const [paperSize, colorMode] = k.split('|')
        return { paperSize, colorMode, ...v }
      })
      .sort((a, b) => b.revenuePaise - a.revenuePaise)

    // Machine-wise: completed print jobs grouped by device (fallback printer name)
    const jobs = await db.printJob.groupBy({
      by: ['deviceId'],
      where: { shopId, status: 'COMPLETED', createdAt: { gte: since }, deviceId: { not: null } },
      _count: true,
    })
    const deviceIds = jobs.map((j) => j.deviceId).filter((x): x is string => !!x)
    const devices = deviceIds.length
      ? await db.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true, machineName: true } })
      : []
    const nameOf = new Map(devices.map((d) => [d.id, d.machineName || d.name]))
    const machine = jobs
      .map((j) => ({
        device: (j.deviceId && nameOf.get(j.deviceId)) || 'Unknown device',
        completedJobs: j._count,
      }))
      .sort((a, b) => b.completedJobs - a.completedJobs)

    const statusCounts = await db.order.groupBy({ by: ['status'], where: { shopId, createdAt: { gte: since } }, _count: true })

    return jsonOk({
      rangeDays: days,
      groupBy: bucket,
      series,
      summary: {
        totalRevenuePaise: series.reduce((s, d) => s + d.revenuePaise, 0),
        totalOrders: series.reduce((s, d) => s + d.orders, 0),
        bwSides,
        colorSides,
        bwRevenuePaise: bwRevenue,
        colorRevenuePaise: colorRevenue,
        sheetsTotal: paper.reduce((s, p) => s + p.sheets, 0),
      },
      paper,
      machine,
      statusCounts: statusCounts.map((s) => ({ status: s.status, count: s._count })),
    })
  })
}
