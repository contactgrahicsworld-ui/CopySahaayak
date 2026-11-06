// Excel (.xlsx) report export — 3 sheets:
//   1. Revenue   — day/week/month collection with order counts
//   2. Paper     — sides/sheets/revenue per paper size × colour mode
//   3. Machines  — completed print jobs per paired device
// Tenant-scoped to the signed-in shop admin. Streams a real .xlsx file.
import ExcelJS from 'exceljs'
import { db } from '@/lib/db'
import { handleRoute } from '@/lib/api'
import { HttpError, requireAnyShopAdmin } from '@/lib/auth'
import { bucketKey, parseBucket, type Bucket } from '@/lib/reports'

export const dynamic = 'force-dynamic'

const inr = (paise: number) => paise / 100

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const url = new URL(req.url)
    const daysRaw = Number(url.searchParams.get('days') ?? '30')
    if (!Number.isFinite(daysRaw) || daysRaw < 7 || daysRaw > 365)
      throw new HttpError(400, 'days must be a number between 7 and 365')
    const days = Math.floor(daysRaw)
    const groupRaw = url.searchParams.get('groupBy')
    if (groupRaw !== null && groupRaw !== '' && groupRaw !== 'day' && groupRaw !== 'week' && groupRaw !== 'month')
      throw new HttpError(400, 'groupBy must be one of: day, week, month')
    const bucket: Bucket = parseBucket(groupRaw)
    const since = new Date(Date.now() - days * 86400000)

    const shop = await db.shop.findUnique({ where: { id: shopId }, select: { name: true, slug: true } })

    const orders = await db.order.findMany({
      where: { shopId, createdAt: { gte: since }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
      select: {
        createdAt: true, totalPaise: true, orderNumber: true,
        items: { select: { colorMode: true, paperSize: true, pageCount: true, copies: true, duplex: true, totalPaise: true } },
      },
    })

    const wb = new ExcelJS.Workbook()
    wb.creator = 'CopySahaayak'
    wb.created = new Date()

    // ---- Sheet 1: Revenue ----
    const rev = wb.addWorksheet(`Revenue (${bucket})`)
    rev.columns = [
      { header: 'Period', key: 'period', width: 14 },
      { header: 'Orders', key: 'orders', width: 10 },
      { header: 'Collection (₹)', key: 'revenue', width: 16 },
    ]
    const byBucket = new Map<string, { revenuePaise: number; orders: number }>()
    for (const o of orders) {
      const k = bucketKey(o.createdAt, bucket)
      const cur = byBucket.get(k) || { revenuePaise: 0, orders: 0 }
      cur.revenuePaise += o.totalPaise
      cur.orders += 1
      byBucket.set(k, cur)
    }
    let totalRevenue = 0
    Array.from(byBucket.entries()).sort(([a], [b]) => a.localeCompare(b)).forEach(([period, v]) => {
      totalRevenue += v.revenuePaise
      rev.addRow({ period, orders: v.orders, revenue: inr(v.revenuePaise) })
    })
    const revTotal = rev.addRow({ period: 'TOTAL', orders: orders.length, revenue: inr(totalRevenue) })
    revTotal.font = { bold: true }
    rev.getColumn('revenue').numFmt = '#,##0.00'

    // ---- Sheet 2: Paper usage ----
    const paper = wb.addWorksheet('Paper Usage')
    paper.columns = [
      { header: 'Paper size', key: 'size', width: 12 },
      { header: 'Colour mode', key: 'mode', width: 14 },
      { header: 'Printed sides', key: 'sides', width: 14 },
      { header: 'Sheets used', key: 'sheets', width: 13 },
      { header: 'Revenue (₹)', key: 'revenue', width: 14 },
    ]
    const paperMap = new Map<string, { sides: number; sheets: number; revenuePaise: number }>()
    for (const o of orders) {
      for (const item of o.items) {
        const sides = item.pageCount * item.copies
        const sheets = Math.ceil(sides / (item.duplex ? 2 : 1))
        const k = `${item.paperSize}|${item.colorMode}`
        const p = paperMap.get(k) || { sides: 0, sheets: 0, revenuePaise: 0 }
        p.sides += sides
        p.sheets += sheets
        p.revenuePaise += item.totalPaise
        paperMap.set(k, p)
      }
    }
    Array.from(paperMap.entries())
      .sort((a, b) => b[1].revenuePaise - a[1].revenuePaise)
      .forEach(([k, v]) => {
        const [size, mode] = k.split('|')
        paper.addRow({ size, mode: mode === 'BW' ? 'Black & White' : 'Colour', sides: v.sides, sheets: v.sheets, revenue: inr(v.revenuePaise) })
      })
    paper.getColumn('revenue').numFmt = '#,##0.00'

    // ---- Sheet 3: Machine usage ----
    const mach = wb.addWorksheet('Machines')
    mach.columns = [
      { header: 'Device', key: 'device', width: 30 },
      { header: 'Completed jobs', key: 'jobs', width: 15 },
    ]
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
    if (jobs.length === 0) mach.addRow({ device: 'No completed prints in this period', jobs: 0 })
    jobs
      .sort((a, b) => b._count - a._count)
      .forEach((j) => mach.addRow({ device: (j.deviceId && nameOf.get(j.deviceId)) || 'Unknown device', jobs: j._count }))

    // Style all header rows
    for (const ws of [rev, paper, mach]) {
      ws.getRow(1).font = { bold: true }
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF0' } }
    }

    const slug = shop?.slug || shopId.slice(0, 6)
    const stamp = new Date().toISOString().slice(0, 10)
    const filename = `${slug}-report-${bucket}-${stamp}.xlsx`
    const buffer = await wb.xlsx.writeBuffer()

    return new Response(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  })
}
