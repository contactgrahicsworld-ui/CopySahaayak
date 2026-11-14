// Order lifecycle: creation, UPI QR, UTR submission, verification, print job fan-out,
// spooler-verified completion. All state transitions live here — API routes stay thin.
import { db, TX, retryDb } from '@/lib/db'
import { LIMITS, type ColorMode, type PaperSize } from '@/lib/constants'
import { HttpError } from '@/lib/auth'
import { calculatePrice } from '@/lib/pricing'
import { generateUpiQr } from '@/lib/upi'
import { audit } from '@/lib/audit'
import { orderNumber } from '@/lib/api'
import { fileUrl } from '@/lib/storage'
import { settings } from '@/lib/settings'
import { sendOrderAlertWhatsApp, waConfigured } from '@/lib/whatsapp'

/** Fire-and-forget WhatsApp owner alert — never blocks or fails the order flow. */
export function ownerAlert(
  shop: { whatsappNumber: string | null },
  orderNumber: string,
  statusText: string,
  note: string
): void {
  if (!waConfigured() || !shop.whatsappNumber) return
  void sendOrderAlertWhatsApp(shop.whatsappNumber, orderNumber, statusText, note).catch(() => {})
}

interface CreateOrderInput {
  shopId: string
  customerSessionId: string
  customerName?: string
  customerPhone?: string
  notes?: string
  items: Array<{
    documentId: string
    colorMode: ColorMode
    paperSize: PaperSize
    duplex: boolean
    copies: number
    pageFrom?: number | null
    pageTo?: number | null
  }>
  ip?: string
}

export async function createOrder(input: CreateOrderInput) {
  const shop = await db.shop.findUnique({ where: { id: input.shopId } })
  if (!shop || !shop.isActive) throw new HttpError(404, 'Shop is not available')
  if (!shop.upiVpa) throw new HttpError(400, 'This shop is not accepting online payments yet')

  const subscription = await db.subscription.findUnique({ where: { shopId: shop.id }, include: { plan: true } })
  await ensureSubscriptionUsable(shop.id, subscription)

  // Validate documents: must belong to this shop, be READY, and be owned by this session
  // (IDOR protection: document IDs from another shop/customer are rejected).
  const docIds = input.items.map((i) => i.documentId)
  const docs = await db.document.findMany({ where: { id: { in: docIds }, shopId: shop.id } })
  if (docs.length !== new Set(docIds).size) throw new HttpError(400, 'One or more documents are invalid')
  for (const d of docs) {
    if (d.status !== 'READY') throw new HttpError(400, 'A document is not ready for printing')
    if (d.customerSessionId && d.customerSessionId !== input.customerSessionId) {
      throw new HttpError(403, 'Document does not belong to this session')
    }
  }

  // Server-side pricing for every line item
  let total = 0
  const priced: Array<{
    documentId: string
    colorMode: ColorMode
    paperSize: PaperSize
    duplex: boolean
    copies: number
    pageFrom: number | null
    pageTo: number | null
    pageCount: number
    unitPricePaise: number
    totalPaise: number
  }> = []
  for (const item of input.items) {
    const doc = docs.find((d) => d.id === item.documentId)!
    const price = await calculatePrice({
      shopId: shop.id,
      colorMode: item.colorMode,
      paperSize: item.paperSize,
      duplex: item.duplex,
      copies: item.copies,
      pageFrom: item.pageFrom ?? null,
      pageTo: item.pageTo ?? null,
      documentPageCount: doc.pageCount,
    })
    total += price.totalPaise
    priced.push({
      documentId: item.documentId,
      colorMode: item.colorMode,
      paperSize: item.paperSize,
      duplex: item.duplex,
      copies: item.copies,
      pageFrom: price.sides === doc.pageCount ? null : (item.pageFrom ?? 1),
      pageTo: price.sides === doc.pageCount ? null : (item.pageTo ?? doc.pageCount),
      pageCount: price.sides,
      unitPricePaise: price.unitPricePaise,
      totalPaise: price.totalPaise,
    })
  }

  // Monthly plan quota check
  if (subscription?.plan.maxOrdersMonth != null) {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const ordersThisMonth = await db.order.count({ where: { shopId: shop.id, createdAt: { gte: monthStart } } })
    if (ordersThisMonth >= subscription.plan.maxOrdersMonth) {
      throw new HttpError(402, 'This shop has reached its monthly order limit. Please try again later.')
    }
  }

  await settings.all() // refresh cache so the synchronous prefix getter is current
  const number = orderNumber(settings.orderPrefix)

  const order = await retryDb(() =>
    db.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        shopId: shop.id,
        orderNumber: number,
        customerSessionId: input.customerSessionId,
        customerName: input.customerName || null,
        customerPhone: input.customerPhone || null,
        notes: input.notes || null,
        status: 'PENDING_PAYMENT',
        totalPaise: total,
        items: { create: priced.map((p) => ({ ...p, shopId: shop.id })) },
      },
      include: { items: true },
    })
    // Link documents to the order
    await tx.document.updateMany({
      where: { id: { in: priced.map((p) => p.documentId) } },
      data: { orderId: created.id },
    })
    // Generate UPI QR with exact amount
    const qr = await generateUpiQr(shop, total, created.orderNumber)
    await tx.payment.create({
      data: {
        orderId: created.id,
        shopId: shop.id,
        method: 'UPI',
        amountPaise: total,
        upiVpa: shop.upiVpa!,
        payeeName: shop.upiPayeeName || shop.name,
        qrPayload: qr.payload,
        txnRef: created.orderNumber,
        status: 'PENDING',
      },
    })
    await tx.notification.create({
      data: { shopId: shop.id, audience: 'SHOP', title: `New order ${created.orderNumber}`, body: `Amount ₹${(total / 100).toFixed(2)} — awaiting UPI payment` },
    })
    return created
  }, TX))

  await audit({
    shopId: shop.id,
    actorType: 'CUSTOMER',
    actorId: input.customerSessionId,
    action: 'ORDER_CREATED',
    entity: 'Order',
    entityId: order.id,
    meta: { orderNumber: order.orderNumber, totalPaise: total, items: priced.length },
    ip: input.ip,
  })

  ownerAlert(shop, order.orderNumber, 'New order received', `Amount ₹${(total / 100).toFixed(2)} — awaiting UPI payment`)

  return order
}

export async function submitUtr(orderId: string, utr: string, payerName?: string, screenshotPath?: string, ip?: string) {
  const payment = await db.payment.findUnique({ where: { orderId }, include: { order: true } })
  if (!payment) throw new HttpError(404, 'Payment not found')
  if (payment.status === 'VERIFIED') throw new HttpError(409, 'Payment already verified')
  if (payment.status === 'SUBMITTED') throw new HttpError(409, 'Payment already submitted and awaiting verification')

  const updated = await retryDb(() =>
    db.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: {
        utr,
        payerName: payerName || null,
        screenshotPath: screenshotPath || null,
        status: 'SUBMITTED',
        submittedAt: new Date(),
      },
    })
    await tx.order.update({ where: { id: orderId }, data: { status: 'AWAITING_VERIFICATION' } })
    await tx.paymentVerification.create({
      data: { paymentId: payment.id, action: 'SUBMIT', note: `UTR ${utr}` },
    })
    await tx.notification.create({
      data: { shopId: payment.shopId, audience: 'SHOP', title: `Payment submitted for ${payment.order.orderNumber}`, body: `UTR ${utr} — verify in Payments tab` },
    })
    return p
  }, TX))
  await audit({
    shopId: payment.shopId,
    actorType: 'CUSTOMER',
    action: 'PAYMENT_UTR_SUBMITTED',
    entity: 'Payment',
    entityId: payment.id,
    meta: { utr, orderNumber: payment.order.orderNumber },
    ip,
  })
  void updated

  const shopForWa = await db.shop.findUnique({ where: { id: payment.shopId }, select: { whatsappNumber: true } })
  if (shopForWa) ownerAlert(shopForWa, payment.order.orderNumber, 'UTR submitted — verify needed', `UTR ${utr}`)
}

export async function verifyPayment(
  paymentId: string,
  action: 'VERIFY' | 'REJECT',
  adminUser: { id: string },
  note?: string,
  ip?: string
) {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { order: true } })
  if (!payment) throw new HttpError(404, 'Payment not found')
  // PENDING (customer never submitted a UTR — e.g. cash or direct UPI on the
  // counter) and SUBMITTED (UTR waiting) are both actionable. VERIFIED/REJECTED
  // are final states.
  if (!['PENDING', 'SUBMITTED'].includes(payment.status)) {
    throw new HttpError(409, 'Payment is not awaiting verification')
  }
  // UTR is optional now: the shop accepts the money it actually received.
  // When a UTR was submitted it is kept in the audit trail below.

  await retryDb(() =>
    db.$transaction(async (tx) => {
    if (action === 'VERIFY') {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'VERIFIED', verifiedByUserId: adminUser.id, verifiedAt: new Date(), rejectionReason: null },
      })
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      })
    } else {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'REJECTED', verifiedByUserId: adminUser.id, verifiedAt: new Date(), rejectionReason: note || 'UTR not matching' },
      })
      await tx.order.update({ where: { id: payment.orderId }, data: { status: 'REJECTED' } })
    }
    await tx.paymentVerification.create({
      data: { paymentId: payment.id, action, adminUserId: adminUser.id, note: note || null },
    })
  }, TX))

  if (action === 'VERIFY') {
    await enqueuePrintJobs(payment.orderId)
    await db.notification.create({
      data: { shopId: payment.shopId, audience: 'SHOP', title: `Payment verified — ${payment.order.orderNumber}`, body: 'Print jobs have been queued to your connector' },
    })
    const shopForWa = await db.shop.findUnique({ where: { id: payment.shopId }, select: { whatsappNumber: true } })
    if (shopForWa) ownerAlert(shopForWa, payment.order.orderNumber, 'Payment verified', 'Print jobs queued to your connector')
  }
  await audit({
    shopId: payment.shopId,
    userId: adminUser.id,
    actorType: 'USER',
    action: action === 'VERIFY' ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
    entity: 'Payment',
    entityId: payment.id,
    meta: { orderNumber: payment.order.orderNumber, utr: payment.utr, note },
    ip,
  })
}

// Fan out confirmed order items to print jobs with printer routing.
export async function enqueuePrintJobs(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } })
  if (!order) return
  const printers = await db.printer.findMany({ where: { shopId: order.shopId, status: 'ONLINE' } })
  const rules = await db.routingRule.findMany({ where: { shopId: order.shopId, isActive: true }, orderBy: { priority: 'desc' } })

  for (const item of order.items) {
    // Explicit routing rule first (colorMode + paperSize, then colorMode any-paper)
    let printer =
      rules.find((r) => r.colorMode === item.colorMode && r.paperSize === item.paperSize)?.printerId ||
      rules.find((r) => r.colorMode === item.colorMode && r.paperSize == null)?.printerId ||
      undefined
    // Fallback: printer tagged with matching color mode, else any online printer
    if (!printer) printer = printers.find((p) => p.colorMode === item.colorMode)?.id
    if (!printer) printer = printers.find((p) => p.colorMode === 'ANY')?.id
    if (!printer && printers.length === 1) printer = printers[0].id

    const existing = await db.printJob.findFirst({ where: { orderItemId: item.id, status: { in: ['QUEUED', 'CLAIMED', 'SPOOLING', 'COMPLETED'] } } })
    if (existing) continue // idempotent fan-out

    try {
      await db.printJob.create({
        data: {
          shopId: order.shopId,
          orderId: order.id,
          orderItemId: item.id,
          documentId: item.documentId,
          printerId: printer || null,
          status: printer ? 'QUEUED' : 'QUEUED',
          spoolDocumentName: `PCS-${order.orderNumber.replace(/[^A-Z0-9]/gi, '')}-${item.id.slice(-6).toUpperCase()}`,
        },
      })
    } catch (err) {
      // @@unique([orderItemId]) makes the fan-out race-free at the DB level:
      // if a concurrent fan-out (e.g. two gateway deliveries racing) created
      // the job between our findFirst and our create, the loser lands here and
      // must treat the item as done — not crash the whole fan-out.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') continue
      throw err
    }
  }
}

// Called by the connector event endpoint — spooler-verified completion.
export async function recordPrintEvent(jobId: string, status: 'SPOOLING' | 'COMPLETED' | 'FAILED', deviceId: string, message?: string) {
  const job = await db.printJob.findUnique({ where: { id: jobId } })
  if (!job) throw new HttpError(404, 'Print job not found')
  if (job.claimedByDeviceId !== deviceId) throw new HttpError(403, 'Job is claimed by another device')
  if (job.status === 'COMPLETED') return // idempotent
  if (job.status === 'CANCELLED') throw new HttpError(409, 'Job was cancelled')

  if (status === 'COMPLETED' && job.status !== 'SPOOLING' && job.status !== 'CLAIMED') {
    // Honesty rule: only the device that holds the claim may report COMPLETED
    // (checked above), and only after it actually took the job. CLAIMED is
    // accepted too: if the best-effort SPOOLING event was lost to a network
    // hiccup, a hard 409 here would make the job permanently un-completable —
    // it would be re-queued and printed twice.
    throw new HttpError(409, 'COMPLETED requires a SPOOLING event first (spooler verification)')
  }

  const orderCompleted = await retryDb(() =>
    db.$transaction(async (tx) => {
    await tx.printEvent.create({
      data: { printJobId: job.id, shopId: job.shopId, deviceId, status, message: message?.slice(0, 480) || null },
    })
    await tx.printJob.update({
      where: { id: job.id },
      data: {
        status,
        completedAt: status === 'COMPLETED' ? new Date() : null,
        leaseUntil: null,
        lastError: status === 'FAILED' ? message?.slice(0, 480) || 'Print failed' : null,
        attempts: status === 'FAILED' ? { increment: 1 } : undefined,
      },
    })
    // Requeue failed jobs automatically while attempts remain
    if (status === 'FAILED' && job.attempts + 1 < job.maxAttempts) {
      await tx.printJob.update({ where: { id: job.id }, data: { status: 'QUEUED', deviceId: null, claimedByDeviceId: null, claimedAt: null } })
    }
    // When every job of the order is completed → order COMPLETED
    if (status === 'COMPLETED') {
      const pending = await tx.printJob.count({
        where: { orderId: job.orderId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      })
      if (pending === 0) {
        await tx.order.update({ where: { id: job.orderId }, data: { status: 'COMPLETED', completedAt: new Date() } })
        return true
      }
    }
    return false
  }, TX))

  // The customer's whole order just finished printing → automatic WhatsApp alert
  // to the customer's own mobile (WhatsApp Cloud API, pre-approved template).
  // Fail-soft: a WhatsApp outage must NEVER block or fail the print pipeline —
  // the connector's tray notification to the shop owner is the other alert path.
  if (orderCompleted) {
    await notifyCustomerOrderPrinted(job.orderId)
  }
}

/** Best-effort WhatsApp "order printed — collect it" message to the customer. */
async function notifyCustomerOrderPrinted(orderId: string): Promise<void> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true, customerPhone: true, customerName: true, shopId: true,
        shop: { select: { name: true } },
      },
    })
    if (!order || !order.customerPhone) return

    const result = await sendOrderAlertWhatsApp(
      order.customerPhone,
      order.orderNumber,
      'print ho gaya ✓',
      `${order.shop.name} se apna print le aaye. Naam: ${order.customerName || '—'}. Dhanyavaad!`,
    )
    await audit({
      shopId: order.shopId,
      actorType: 'SYSTEM',
      action: 'WHATSAPP_ORDER_ALERT',
      entity: 'Order',
      entityId: orderId,
      meta: { status: result.status, detail: result.detail?.slice(0, 120), orderNumber: order.orderNumber },
    })
  } catch (err) {
    // Never let a WhatsApp problem break the device event pipeline.
    console.error('[whatsapp] order alert failed:', err instanceof Error ? err.message : err)
  }
}

export async function ensureSubscriptionUsable(shopId: string, subscription: { status: string; expiresAt: Date | null } | null) {
  if (!subscription || !['ACTIVE', 'PENDING_VERIFICATION'].includes(subscription.status)) {
    throw new HttpError(402, 'Shop subscription is inactive')
  }
  if (subscription.expiresAt && subscription.expiresAt < new Date()) {
    await db.subscription.update({ where: { shopId }, data: { status: 'EXPIRED' } })
    throw new HttpError(402, 'Shop subscription has expired')
  }
}
