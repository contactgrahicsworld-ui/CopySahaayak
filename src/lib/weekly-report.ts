// Weekly backup + revenue report engine (Sunday 04:00 IST cron).
//   • Every shop admin gets a beautifully designed HTML revenue report:
//     B/W revenue, colour revenue, pages used, copies done, pending payments —
//     with an Excel (.xlsx) backup of the week's orders/items/payments attached.
//   • Super admins get one platform-wide report with all shops.
//   • Reports go out one-by-one (sequential) so free-tier SMTP limits are
//     respected; whatever does not fit inside the run budget stays PENDING and
//     is flushed by the Monday cron (and manual ?secret= runs).
import ExcelJS from 'exceljs'
import { db } from '@/lib/db'
import { sendMail, mailTransport } from '@/lib/mailer'

const IST_OFFSET_MS = 5.5 * 3600 * 1000

export interface WeekRange {
  weekStart: Date // Monday 00:00 IST (as UTC instant)
  weekEnd: Date   // next Monday 00:00 IST (exclusive)
}

/** The week that just ended (or is ending), Monday→Monday in IST. */
export function lastWeekRange(now = new Date()): WeekRange {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS)
  const daysSinceMonday = (istNow.getUTCDay() + 6) % 7
  const mondayIstMidnight = Date.UTC(
    istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() - daysSinceMonday,
  )
  return {
    weekEnd: new Date(mondayIstMidnight - IST_OFFSET_MS),
    weekStart: new Date(mondayIstMidnight - 7 * 86400000 - IST_OFFSET_MS),
  }
}

export interface ShopWeekStats {
  shopName: string
  ordersCount: number
  revenuePaise: number
  bw: { revenuePaise: number; pages: number; copies: number }
  color: { revenuePaise: number; pages: number; copies: number }
  pagesTotal: number
  copiesTotal: number
  pendingPayments: { count: number; amountPaise: number }
  newCustomers: number
  topCustomers: Array<{ name: string; phone: string; orders: number; amountPaise: number }>
}

function emptyStats(shopName: string): ShopWeekStats {
  return {
    shopName,
    ordersCount: 0,
    revenuePaise: 0,
    bw: { revenuePaise: 0, pages: 0, copies: 0 },
    color: { revenuePaise: 0, pages: 0, copies: 0 },
    pagesTotal: 0,
    copiesTotal: 0,
    pendingPayments: { count: 0, amountPaise: 0 },
    newCustomers: 0,
    topCustomers: [],
  }
}

/** Paid orders in the window: money the shop actually accepted. */
export async function computeShopStats(shopId: string, range: WeekRange): Promise<ShopWeekStats> {
  const shop = await db.shop.findUnique({ where: { id: shopId }, select: { name: true } })
  const stats = emptyStats(shop?.name ?? 'Shop')

  const orders = await db.order.findMany({
    where: {
      shopId,
      status: { in: ['CONFIRMED', 'COMPLETED'] },
      OR: [{ confirmedAt: { gte: range.weekStart, lt: range.weekEnd } }, { confirmedAt: null, createdAt: { gte: range.weekStart, lt: range.weekEnd } }],
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

  // New customers this week (phone never seen before this week, among paid orders)
  const knownBefore = await db.order.findMany({
    where: { shopId, status: { in: ['CONFIRMED', 'COMPLETED'] }, customerPhone: { not: null }, createdAt: { lt: range.weekStart } },
    select: { customerPhone: true },
  })
  const known = new Set(knownBefore.map((o) => o.customerPhone))
  stats.newCustomers = stats.topCustomers.length > 0
    ? [...new Set(orders.map((o) => o.customerPhone).filter((p) => p && !known.has(p)))].length
    : 0

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

/** Excel backup of the week: Orders / Items / Payments / Summary sheets. */
export async function buildBackupWorkbook(shopId: string, range: WeekRange): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CopySahaayak'
  wb.created = new Date()

  const orders = await db.order.findMany({
    where: { shopId, createdAt: { gte: range.weekStart, lt: range.weekEnd } },
    orderBy: { createdAt: 'asc' },
    include: {
      payment: { select: { utr: true, status: true, amountPaise: true, verifiedAt: true, method: true } },
      items: true,
    },
  })

  const header = (ws: ExcelJS.Worksheet, keys: string[]) => {
    ws.addRow(keys)
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } }
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.columns.forEach((c) => { c.width = Math.max(12, Math.min(30, (c.header?.length ?? 10) + 4)) })
  }
  const inr = (paise: number) => Number((paise / 100).toFixed(2))

  const wsOrders = wb.addWorksheet('Orders')
  header(wsOrders, ['Order No', 'Date (IST)', 'Customer', 'Mobile', 'Status', 'Amount ₹', 'Payment status', 'UTR', 'Verified at (IST)'])
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
  header(wsItems, ['Order No', 'Document', 'Colour mode', 'Paper', 'Sides', 'Copies', 'Duplex', 'Amount ₹'])
  for (const o of orders) {
    for (const it of o.items) {
      wsItems.addRow([
        o.orderNumber, it.documentId.slice(-8), it.colorMode === 'COLOR' ? 'Colour' : 'B/W',
        it.paperSize, it.pageCount, it.copies, it.duplex ? 'Yes' : 'No', inr(it.totalPaise),
      ])
    }
  }

  const wsPay = wb.addWorksheet('Payments')
  header(wsPay, ['Order No', 'Method', 'Amount ₹', 'Status', 'UTR', 'Verified at (IST)'])
  for (const o of orders) {
    if (!o.payment) continue
    wsPay.addRow([o.orderNumber, o.payment.method, inr(o.payment.amountPaise), o.payment.status, o.payment.utr || '', o.payment.verifiedAt ? o.payment.verifiedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''])
  }

  const stats = await computeShopStats(shopId, range)
  const wsSum = wb.addWorksheet('Summary')
  wsSum.addRow(['Weekly summary'])
  wsSum.getRow(1).font = { bold: true }
  wsSum.addRows([
    ['Week', `${range.weekStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} → ${range.weekEnd.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}`],
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
  wsSum.getColumn(1).font = { bold: true }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}

const inrFmt = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Designed HTML report (email-client safe, table layout). */
export function buildShopReportEmail(stats: ShopWeekStats, range: WeekRange, kind: 'SHOP' | 'PLATFORM'): string {
  const dateLine = `${range.weekStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })} – ${range.weekEnd.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })}`
  const card = (label: string, value: string, color = '#111827') => `
    <td style="width:33.33%;padding:8px">
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 10px;text-align:center">
        <div style="font-size:20px;font-weight:700;color:${color}">${value}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px">${label}</div>
      </div>
    </td>`

  const topRows = stats.topCustomers.length
    ? `<tr><td colspan="2" style="padding:6px 2px 2px">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <tr style="color:#6b7280"><th align="left" style="padding:6px">ग्राहक / Customer</th><th align="left" style="padding:6px">ऑर्डर</th><th align="right" style="padding:6px">रकम</th></tr>
          ${stats.topCustomers.map((c) => `<tr>
            <td style="padding:6px;border-top:1px solid #f3f4f6">${c.name || '—'}<span style="color:#9ca3af"> ${c.phone}</span></td>
            <td style="padding:6px;border-top:1px solid #f3f4f6">${c.orders}</td>
            <td align="right" style="padding:6px;border-top:1px solid #f3f4f6">${inrFmt(c.amountPaise)}</td>
          </tr>`).join('')}
        </table>
      </td></tr>`
    : ''

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f3f4f6">
  <div style="max-width:560px;margin:0 auto;padding:20px 12px;font-family:Segoe UI,Arial,sans-serif">
    <div style="background:linear-gradient(135deg,#16a34a,#0d9488);border-radius:14px 14px 0 0;padding:20px 24px;color:#fff">
      <div style="font-size:12px;opacity:.85">${kind === 'PLATFORM' ? 'CopySahaayak · साप्ताहिक प्लेटफ़ॉर्म रिपोर्ट' : 'CopySahaayak · साप्ताहिक रिपोर्ट'}</div>
      <div style="font-size:20px;font-weight:700;margin-top:2px">${stats.shopName}</div>
      <div style="font-size:12px;opacity:.9">${dateLine}</div>
    </div>
    <div style="background:#fff;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 14px 14px;padding:18px 14px 14px">
      <table style="width:100%;border-collapse:separate;border-spacing:0">
        <tr>
          ${card('कुल कमाई / Total revenue', inrFmt(stats.revenuePaise), '#16a34a')}
          ${card('पेड ऑर्डर / Paid orders', String(stats.ordersCount))}
          ${card('कुल पेज / Pages', String(stats.pagesTotal))}
        </tr>
        <tr>
          ${card('B/W कमाई', inrFmt(stats.bw.revenuePaise))}
          ${card('Colour कमाई', inrFmt(stats.color.revenuePaise), '#7c3aed')}
          ${card('कुल कॉपियाँ / Copies', String(stats.copiesTotal))}
        </tr>
        <tr>
          ${card('B/W पेज', String(stats.bw.pages))}
          ${card('Colour पेज', String(stats.color.pages))}
          ${card('पेंडिंग पेमेंट', `${stats.pendingPayments.count} (${inrFmt(stats.pendingPayments.amountPaise)})`, stats.pendingPayments.count ? '#d97706' : '#111827')}
        </tr>
      </table>
      <table style="width:100%;font-size:13px;margin-top:6px">
        ${topRows}
        <tr><td colspan="2" style="padding:10px 2px 2px;color:#6b7280;font-size:12px">
          इस ईमेल में पूरे हफ़्ते का Excel बैकअप (Orders / Items / Payments / Summary) अटैच है।
          <span style="display:block">The full week's Excel backup is attached to this email.</span>
        </td></tr>
      </table>
    </div>
    <div style="text-align:center;color:#9ca3af;font-size:11px;padding:12px">CopySahaayak — weekly automatic report (सुबह 4:00 बजे हर रविवार)</div>
  </div>
</body></html>`
}

export function weekLabel(range: WeekRange): string {
  const s = range.weekStart.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' })
  const e = range.weekEnd.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
  return `${s} to ${e}`
}

/** Which email addresses receive a shop's report (active admin users). */
export async function shopReportRecipients(shopId: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { shopId, isActive: true, role: { in: ['SHOP_ADMIN', 'SHOP_STAFF'] } },
    select: { email: true },
  })
  return users.map((u) => u.email.toLowerCase()).filter((e) => e.includes('@'))
}

export async function platformReportRecipients(): Promise<string[]> {
  const users = await db.user.findMany({
    where: { isActive: true, role: 'SUPER_ADMIN' },
    select: { email: true },
  })
  return users.map((u) => u.email.toLowerCase()).filter((e) => e.includes('@'))
}

export interface SeedResult {
  weekStart: Date
  weekEnd: Date
  seeded: number
  existing: number
}

/** Idempotent: one PENDING row per shop-admin + platform rows for super admins. */
export async function seedWeeklyQueue(): Promise<SeedResult> {
  const range = lastWeekRange()
  let seeded = 0
  let existing = 0

  const shops = await db.shop.findMany({ where: { isActive: true }, select: { id: true } })
  for (const shop of shops) {
    for (const recipient of await shopReportRecipients(shop.id)) {
      const found = await db.weeklyReport.findFirst({
        where: { shopId: shop.id, weekStart: range.weekStart, kind: 'SHOP', recipient },
      })
      if (found) { existing += 1; continue }
      await db.weeklyReport.create({
        data: { shopId: shop.id, weekStart: range.weekStart, weekEnd: range.weekEnd, recipient, kind: 'SHOP' },
      })
      seeded += 1
    }
  }
  for (const recipient of await platformReportRecipients()) {
    const found = await db.weeklyReport.findFirst({
      where: { shopId: null, weekStart: range.weekStart, kind: 'PLATFORM', recipient },
    })
    if (found) { existing += 1; continue }
    await db.weeklyReport.create({
      data: { shopId: null, weekStart: range.weekStart, weekEnd: range.weekEnd, recipient, kind: 'PLATFORM' },
    })
    seeded += 1
  }
  return { ...range, seeded, existing }
}

export interface SendOutcome {
  attempted: number
  sent: number
  failed: number
  remaining: number
  transport: string
  errors: string[]
}

/**
 * Sends queued reports one-by-one (oldest first, FAILED rows retried up to 5
 * attempts). Stops when the budget or maxSends is reached — the rest stay
 * PENDING for the next cron run (Monday flush / manual run).
 */
export async function processWeeklyQueue(budgetMs = 50000, maxSends = 4): Promise<SendOutcome> {
  const out: SendOutcome = { attempted: 0, sent: 0, failed: 0, remaining: 0, transport: mailTransport, errors: [] }
  if (mailTransport !== 'smtp' && mailTransport !== 'resend' && mailTransport !== 'mock') {
    out.remaining = await db.weeklyReport.count({ where: { status: 'PENDING' } })
    out.errors.push('No attachments-capable email transport configured. Set SMTP_HOST / SMTP_USER / SMTP_PASS (Gmail app password) in Vercel env vars.')
    return out
  }

  const started = Date.now()
  for (;;) {
    const batch = await db.weeklyReport.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 } },
      orderBy: { createdAt: 'asc' },
      take: 1,
    })
    const row = batch[0]
    if (!row) break
    if (out.attempted >= maxSends || Date.now() - started > budgetMs) break
    out.attempted += 1

    try {
      const range: WeekRange = { weekStart: row.weekStart, weekEnd: row.weekEnd }
      let stats: ShopWeekStats
      let attachment: { filename: string; content: Buffer; contentType: string } | undefined

      if (row.kind === 'PLATFORM') {
        stats = emptyStats('CopySahaayak — All Shops')
        const shops = await db.shop.findMany({ where: { isActive: true }, select: { id: true } })
        for (const s of shops) {
          const st = await computeShopStats(s.id, range)
          stats.revenuePaise += st.revenuePaise
          stats.ordersCount += st.ordersCount
          stats.pagesTotal += st.pagesTotal
          stats.copiesTotal += st.copiesTotal
          stats.bw.revenuePaise += st.bw.revenuePaise
          stats.color.revenuePaise += st.color.revenuePaise
        }
        attachment = {
          filename: `CopySahaayak-Platform-${weekLabel(range).replace(/\s/g, '')}.xlsx`,
          content: await buildPlatformWorkbook(range),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
      } else if (row.shopId) {
        stats = await computeShopStats(row.shopId, range)
        attachment = {
          filename: `${stats.shopName.replace(/[^A-Za-z0-9]+/g, '-')}-Week-${weekLabel(range).replace(/\s/g, '')}.xlsx`,
          content: await buildBackupWorkbook(row.shopId, range),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
      } else {
        throw new Error('WeeklyReport row has no shopId and is not PLATFORM')
      }

      await sendMail({
        to: row.recipient,
        subject: `CopySahaayak weekly report — ${stats.shopName} (${weekLabel(range)}) · ${inrFmt(stats.revenuePaise)}`,
        text: `${stats.shopName} — week ${weekLabel(range)}\nPaid orders: ${stats.ordersCount}\nRevenue: ${inrFmt(stats.revenuePaise)}\nB/W: ${inrFmt(stats.bw.revenuePaise)} (${stats.bw.pages} pages)\nColour: ${inrFmt(stats.color.revenuePaise)} (${stats.color.pages} pages)\nCopies: ${stats.copiesTotal}\nExcel backup attached.`,
        html: buildShopReportEmail(stats, range, row.kind as 'SHOP' | 'PLATFORM'),
        attachments: attachment ? [attachment] : undefined,
      })
      await db.weeklyReport.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
      })
      out.sent += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      out.errors.push(`${row.recipient}: ${message.slice(0, 160)}`)
      await db.weeklyReport.update({
        where: { id: row.id },
        data: { status: 'FAILED', attempts: { increment: 1 }, lastError: message.slice(0, 480) },
      })
      out.failed += 1
    }
  }

  out.remaining = await db.weeklyReport.count({ where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 5 } } })
  return out
}

/** Platform workbook: one Summary sheet + per-shop rows. */
export async function buildPlatformWorkbook(range: WeekRange): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CopySahaayak'
  const ws = wb.addWorksheet('All Shops')
  ws.addRow(['Shop', 'Paid orders', 'Revenue ₹', 'B/W ₹', 'Colour ₹', 'Pages', 'Copies'])
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } }
  const shops = await db.shop.findMany({ where: { isActive: true }, select: { id: true, name: true } })
  for (const s of shops) {
    const st = await computeShopStats(s.id, range)
    ws.addRow([
      st.shopName, st.ordersCount, st.revenuePaise / 100, st.bw.revenuePaise / 100,
      st.color.revenuePaise / 100, st.pagesTotal, st.copiesTotal,
    ])
  }
  ws.columns.forEach((c) => { c.width = Math.max(14, Math.min(30, (String(c.header ?? '')).length + 6)) })
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
