// Manual backup engine — admin / super admin download their own Excel backup
// straight from the dashboard (mobile or PC). No cron, no automatic email:
// the ONLY automatic mail this platform sends is the forgot-password OTP,
// which always goes to the user's own email address (Supabase free tier).
//
// The workbook is the full backup: Orders / Items / Payments / Summary with
// revenue split (B/W vs colour), pages used, copies done and pending payments.
import ExcelJS from 'exceljs'
import { db } from '@/lib/db'

export interface BackupRange {
  /** Inclusive lower bound (as UTC instant). */
  start: Date
  /** Exclusive upper bound. */
  end: Date
  /** Human label used in the Summary sheet and the filename. */
  label: string
}

export type BackupPreset = 'week' | 'month' | 'all'

/** Resolve a preset to a concrete date range (IST-friendly, now-anchored). */
export function resolveBackupRange(preset: BackupPreset, now = new Date()): BackupRange {
  const end = new Date(now.getTime() + 60 * 1000) // small slack for clock skew
  if (preset === 'week') {
    return { start: new Date(now.getTime() - 7 * 86400000), end, label: 'Last-7-days' }
  }
  if (preset === 'month') {
    return { start: new Date(now.getTime() - 30 * 86400000), end, label: 'Last-30-days' }
  }
  return { start: new Date(Date.UTC(2000, 0, 1)), end, label: 'All-time' }
}

export interface ShopStats {
  shopName: string
  ordersCount: number
  revenuePaise: number
  bw: { revenuePaise: number; pages: number; copies: number }
  color: { revenuePaise: number; pages: number; copies: number }
  pagesTotal: number
  copiesTotal: number
  pendingPayments: { count: number; amountPaise: number }
  topCustomers: Array<{ name: string; phone: string; orders: number; amountPaise: number }>
}

/** Paid orders in the window: money the shop actually accepted. */
export async function computeShopStats(shopId: string, range: BackupRange): Promise<ShopStats> {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { name: true } })
  const stats: ShopStats = {
    shopName: shop?.name ?? 'Shop',
    ordersCount: 0,
    revenuePaise: 0,
    bw: { revenuePaise: 0, pages: 0, copies: 0 },
    color: { revenuePaise: 0, pages: 0, copies: 0 },
    pagesTotal: 0,
    copiesTotal: 0,
    pendingPayments: { count: 0, amountPaise: 0 },
    topCustomers: [],
  }

  const orders = await db.order.findMany({
    where: {
      shopId,
      status: { in: ['CONFIRMED', 'COMPLETED'] },
      createdAt: { gte: range.start, lt: range.end },
    },
    select: {
      orderNumber: true, customerName: true, customerPhone: true, totalPaise: true,
      items: { select: { colorMode: true, pageCount: true, copies: true, totalPaise: true } },
    },
  })

  for (const o of orders) {
    stats.ordersCount += 1
    stats.revenuePaise += o.totalPaise
    for (const it of o.items) {
      const bucket = it.colorMode === 'COLOR' ? stats.color : stats.bw
      bucket.revenuePaise += it.totalPaise
      bucket.pages += it.pageCount * it.copies
      bucket.copies += it.copies
      stats.pagesTotal += it.pageCount * it.copies
      stats.copiesTotal += it.copies
    }
    if (o.customerPhone) {
      const existing = stats.topCustomers.find((c) => c.phone === o.customerPhone)
      if (existing) {
        existing.orders += 1
        existing.amountPaise += o.totalPaise
        if (!existing.name && o.customerName) existing.name = o.customerName
      } else {
        stats.topCustomers.push({
          name: o.customerName || '', phone: o.customerPhone, orders: 1, amountPaise: o.totalPaise,
        })
      }
    }
  }
  stats.topCustomers.sort((a, b) => b.amountPaise - a.amountPaise)
  stats.topCustomers = stats.topCustomers.slice(0, 5)

  const pendings = await db.payment.aggregate({
    where: { shopId, status: { in: ['PENDING', 'SUBMITTED'] } },
    _count: { id: true },
    _sum: { amountPaise: true },
  })
  stats.pendingPayments = {
    count: pendings._count.id,
    amountPaise: pendings._sum.amountPaise ?? 0,
  }

  return stats
}

/** Excel backup: Orders / Items / Payments / Summary sheets. */
export async function buildBackupWorkbook(shopId: string, range: BackupRange): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CopySahaayak'
  wb.created = new Date()

  const orders = await db.order.findMany({
    where: { shopId, createdAt: { gte: range.start, lt: range.end } },
    orderBy: { createdAt: 'asc' },
    include: {
      payment: { select: { utr: true, status: true, amountPaise: true, verifiedAt: true, method: true } },
      items: true,
    },
  })

  const header = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } }
    ws.columns.forEach((c) => { c.width = Math.max(12, Math.min(30, (String(c.header ?? '')).length + 4)) })
  }
  const inr = (paise: number) => Number((paise / 100).toFixed(2))

  const wsOrders = wb.addWorksheet('Orders')
  wsOrders.columns = [
    { header: 'Order No', key: 'no', width: 16 },
    { header: 'Date (IST)', key: 'date', width: 22 },
    { header: 'Customer', key: 'cust', width: 20 },
    { header: 'Mobile', key: 'mob', width: 14 },
    { header: 'Status', key: 'st', width: 12 },
    { header: 'Amount ₹', key: 'amt', width: 12 },
    { header: 'Payment status', key: 'pst', width: 14 },
    { header: 'UTR', key: 'utr', width: 20 },
    { header: 'Verified at (IST)', key: 'vat', width: 22 },
  ]
  header(wsOrders)
  for (const o of orders) {
    wsOrders.addRow([
      o.orderNumber,
      o.createdAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      o.customerName || '', o.customerPhone || '',
      o.status, inr(o.totalPaise),
      o.payment?.status || '', o.payment?.utr || '',
      o.payment?.verifiedAt ? o.payment.verifiedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
    ])
  }

  const wsItems = wb.addWorksheet('Items')
  wsItems.columns = [
    { header: 'Order No', key: 'no', width: 16 },
    { header: 'Document', key: 'doc', width: 14 },
    { header: 'Colour mode', key: 'cm', width: 12 },
    { header: 'Paper', key: 'pp', width: 10 },
    { header: 'Pages', key: 'pg', width: 10 },
    { header: 'Copies', key: 'cp', width: 10 },
    { header: 'Duplex', key: 'dx', width: 10 },
    { header: 'Amount ₹', key: 'amt', width: 12 },
  ]
  header(wsItems)
  for (const o of orders) {
    for (const it of o.items) {
      wsItems.addRow([
        o.orderNumber, it.documentId.slice(-8), it.colorMode === 'COLOR' ? 'Colour' : 'B/W',
        it.paperSize, it.pageCount, it.copies, it.duplex ? 'Yes' : 'No', inr(it.totalPaise),
      ])
    }
  }

  const wsPay = wb.addWorksheet('Payments')
  wsPay.columns = [
    { header: 'Order No', key: 'no', width: 16 },
    { header: 'Method', key: 'm', width: 12 },
    { header: 'Amount ₹', key: 'amt', width: 12 },
    { header: 'Status', key: 'st', width: 12 },
    { header: 'UTR', key: 'utr', width: 20 },
    { header: 'Verified at (IST)', key: 'vat', width: 22 },
  ]
  header(wsPay)
  for (const o of orders) {
    if (!o.payment) continue
    wsPay.addRow([o.orderNumber, o.payment.method, inr(o.payment.amountPaise), o.payment.status, o.payment.utr || '', o.payment.verifiedAt ? o.payment.verifiedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''])
  }

  const stats = await computeShopStats(shopId, range)
  const wsSum = wb.addWorksheet('Summary')
  wsSum.getColumn(1).font = { bold: true }
  wsSum.addRows([
    ['CopySahaayak — Data backup'],
    ['Shop', stats.shopName],
    ['Range', range.label],
    ['Generated at (IST)', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    [],
    ['Paid orders', stats.ordersCount],
    ['Total revenue ₹', inr(stats.revenuePaise)],
    ['B/W revenue ₹', inr(stats.bw.revenuePaise)],
    ['Colour revenue ₹', inr(stats.color.revenuePaise)],
    ['Pages printed (B/W)', stats.bw.pages],
    ['Pages printed (Colour)', stats.color.pages],
    ['Pages total', stats.pagesTotal],
    ['Copies total', stats.copiesTotal],
    ['Pending payments', `${stats.pendingPayments.count} (₹${inr(stats.pendingPayments.amountPaise)})`],
  ])
  if (stats.topCustomers.length > 0) {
    wsSum.addRow([])
    wsSum.addRow(['Top customers'])
    wsSum.addRow(['Customer', 'Mobile', 'Orders', 'Amount ₹'])
    for (const c of stats.topCustomers) {
      wsSum.addRow([c.name || '—', c.phone, c.orders, inr(c.amountPaise)])
    }
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

const inrFmt = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Platform workbook: one sheet with per-shop rows (super admin, all shops). */
export async function buildPlatformWorkbook(range: BackupRange): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CopySahaayak'
  const ws = wb.addWorksheet('All Shops')
  ws.columns = [
    { header: 'Shop', key: 'shop', width: 26 },
    { header: 'Paid orders', key: 'orders', width: 12 },
    { header: 'Revenue ₹', key: 'rev', width: 14 },
    { header: 'B/W ₹', key: 'bw', width: 12 },
    { header: 'Colour ₹', key: 'col', width: 12 },
    { header: 'Pages', key: 'pg', width: 10 },
    { header: 'Copies', key: 'cp', width: 10 },
    { header: 'Pending payments', key: 'pend', width: 18 },
  ]
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } }

  let totOrders = 0, totRev = 0, totBw = 0, totCol = 0, totPages = 0, totCopies = 0, totPend = 0
  const shops = await db.shop.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
  for (const s of shops) {
    const st = await computeShopStats(s.id, range)
    totOrders += st.ordersCount; totRev += st.revenuePaise
    totBw += st.bw.revenuePaise; totCol += st.color.revenuePaise
    totPages += st.pagesTotal; totCopies += st.copiesTotal
    totPend += st.pendingPayments.amountPaise
    ws.addRow([
      st.shopName, st.ordersCount, st.revenuePaise / 100, st.bw.revenuePaise / 100,
      st.color.revenuePaise / 100, st.pagesTotal, st.copiesTotal,
      `${st.pendingPayments.count} (${inrFmt(st.pendingPayments.amountPaise)})`,
    ])
  }
  ws.addRow([])
  ws.addRow(['TOTAL', totOrders, totRev / 100, totBw / 100, totCol / 100, totPages, totCopies, inrFmt(totPend)])
  const lastRow = ws.lastRow
  if (lastRow) lastRow.font = { bold: true }

  const info = wb.addWorksheet('Info')
  info.getColumn(1).font = { bold: true }
  info.addRows([
    ['CopySahaayak — Platform backup (all shops)'],
    ['Range', range.label],
    ['Generated at (IST)', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Shops', shops.length],
  ])
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
