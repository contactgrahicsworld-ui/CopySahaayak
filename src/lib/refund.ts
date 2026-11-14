// MONEY-SAFETY ENGINE — "customer ka paisa kabhi na fase, shop admin ka paisa
// kabhi na fase". Whenever the gateway proves real money arrived but the
// workflow cannot honour it (order cancelled after capture, duplicate capture
// for one order/payment), the payment is atomically flagged REFUND_DUE and
// every stakeholder is notified. The refund itself is a UPI transfer back to
// the payer: the customer submits their own UPI ID on the order tracker
// (prefilled pay link for the shop), the super admin records the refund UTR
// for subscriptions. Nothing here trusts the client — only signed gateway
// events or already-VERIFIED payments can trigger a refund flag.
//
// ATOMICITY: the flag transition is an atomic conditional UPDATE (VERIFIED ->
// REFUND_DUE / REFUNDED) so concurrent webhook deliveries can never double
// flag or lose the flag. Audit rows + notifications are best-effort but loud.
import { db, retryDb, TX } from '@/lib/db'
import { audit } from '@/lib/audit'

export type RefundDueReason =
  | 'duplicate-capture' // second gateway capture for one payment row
  | 'order-cancelled-after-capture' // order cancelled while money already in
  | 'subscription-capture-unmatched' // money arrived but no open payment intent

async function safeAudit(entry: Parameters<typeof audit>[0]): Promise<void> {
  try {
    await audit(entry)
  } catch (err) {
    console.error('refund: audit write failed (non-fatal)', err)
  }
}

/** Customer → shop money: flag VERIFIED payment as REFUND_DUE. */
export async function markOrderRefundDue(paymentId: string, reason: RefundDueReason, meta: { orderNumber: string; gatewayRef?: string; amountPaise: number; deliveryId?: string }): Promise<boolean> {
  const row = await retryDb(() =>
    db.payment.findUnique({ where: { id: paymentId }, select: { shopId: true, status: true } })
  )
  if (!row) return false
  let flagged = false
  await retryDb(() =>
    db.$transaction(async (tx) => {
      const claim = await tx.payment.updateMany({
        where: { id: paymentId, status: 'VERIFIED' },
        data: { status: 'REFUND_DUE', rejectionReason: `refund due: ${reason}` },
      })
      if (claim.count === 0) return
      flagged = true
      await tx.paymentVerification.create({
        data: { paymentId, action: 'REFUND_DUE', adminUserId: null, note: reason },
      })
    }, TX)
  )
  if (!flagged) return false
  await safeAudit({
    shopId: row.shopId,
    actorType: 'SYSTEM',
    action: 'PAYMENT_REFUND_DUE',
    entity: 'Payment',
    entityId: paymentId,
    meta: { ...meta, reason },
  })
  await retryDb(() =>
    db.notification
      .create({
        data: {
          shopId: row.shopId,
          audience: 'SHOP',
          title: `REFUND karni hai — ${meta.orderNumber}`,
          body: `Gateway ne dobara/extra payment capture kiya ya order cancel hua (₹${(meta.amountPaise / 100).toFixed(2)}). Customer apni UPI ID tracker par de dega — payments tab me "Refund" card se paisa wapas karein aur Refunded mark karein.`,
        },
      })
      .catch(() => null)
  )
  return true
}

/** Shop → platform money: flag VERIFIED subscription payment as REFUND_DUE. */
export async function markSubRefundDue(subPaymentId: string, reason: RefundDueReason, meta: { planCode?: string; gatewayRef?: string; amountPaise: number; deliveryId?: string }): Promise<boolean> {
  const row = await retryDb(() =>
    db.subscriptionPayment.findUnique({ where: { id: subPaymentId }, select: { shopId: true, status: true } })
  )
  if (!row) return false
  let flagged = false
  await retryDb(() =>
    db.$transaction(async (tx) => {
      const claim = await tx.subscriptionPayment.updateMany({
        where: { id: subPaymentId, status: 'VERIFIED' },
        data: { status: 'REFUND_DUE', rejectionReason: `refund due: ${reason}` },
      })
      if (claim.count === 0) return
      flagged = true
    }, TX)
  )
  if (!flagged) return false
  await safeAudit({
    shopId: row.shopId,
    actorType: 'SYSTEM',
    action: 'SUBSCRIPTION_REFUND_DUE',
    entity: 'SubscriptionPayment',
    entityId: subPaymentId,
    meta: { ...meta, reason },
  })
  for (const audience of ['SUPER', 'SHOP'] as const) {
    await retryDb(() =>
      db.notification
        .create({
          data: {
            shopId: row.shopId,
            audience,
            title: audience === 'SUPER' ? `Subscription REFUND due (₹${(meta.amountPaise / 100).toFixed(2)})` : 'Plan payment refund in progress',
            body:
              audience === 'SUPER'
                ? `Gateway capture duplicate/unmatched hai. Sub-payments tab me is payment ko "Refunded" mark karein (refund UTR ke saath).`
                : 'Aapka plan payment platform ko dobara/extra mila hai — platform wapas karega. Status order tracker me dikhega.',
          },
        })
        .catch(() => null)
    )
  }
  return true
}

/** Shop marks the customer refund done (UTR from their UPI app). */
export async function markOrderRefunded(paymentId: string, adminUserId: string, data: { refundUtr?: string; refundVpa?: string; note?: string }): Promise<{ ok: boolean; reason?: string }> {
  const payment = await retryDb(() => db.payment.findUnique({ where: { id: paymentId }, select: { status: true, shopId: true, order: { select: { orderNumber: true } } } }))
  if (!payment) return { ok: false, reason: 'payment not found' }
  if (!['REFUND_DUE', 'VERIFIED'].includes(payment.status)) return { ok: false, reason: `payment is ${payment.status} — refund not due` }
  let done = false
  await retryDb(() =>
    db.$transaction(async (tx) => {
      const claim = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: ['REFUND_DUE', 'VERIFIED'] } },
        data: {
          status: 'REFUNDED',
          ...(data.refundUtr ? { refundUtr: data.refundUtr } : {}),
          ...(data.refundVpa ? { refundVpa: data.refundVpa } : {}),
        },
      })
      if (claim.count === 0) return
      done = true
      await tx.paymentVerification.create({
        data: { paymentId, action: 'REFUND', adminUserId, note: data.note || data.refundUtr || 'refund sent via UPI' },
      })
    }, TX)
  )
  if (!done) return { ok: false, reason: 'already refunded' }
  await safeAudit({
    shopId: payment.shopId,
    userId: adminUserId,
    actorType: 'USER',
    action: 'PAYMENT_REFUNDED',
    entity: 'Payment',
    entityId: paymentId,
    meta: { orderNumber: payment.order.orderNumber, refundUtr: data.refundUtr, refundVpa: data.refundVpa },
  })
  await retryDb(() =>
    db.notification
      .create({
        data: { shopId: payment.shopId, audience: 'SHOP', title: `Refund marked — ${payment.order.orderNumber}`, body: 'Customer ko tracker me REFUNDED status dikhega.' },
      })
      .catch(() => null)
  )
  return { ok: true }
}

/** Super admin marks the subscription refund done. */
export async function markSubRefunded(subPaymentId: string, adminUserId: string, data: { refundUtr?: string; refundVpa?: string; note?: string }): Promise<{ ok: boolean; reason?: string }> {
  const sp = await retryDb(() => db.subscriptionPayment.findUnique({ where: { id: subPaymentId }, select: { status: true, shopId: true } }))
  if (!sp) return { ok: false, reason: 'payment not found' }
  if (!['REFUND_DUE', 'VERIFIED'].includes(sp.status)) return { ok: false, reason: `payment is ${sp.status} — refund not due` }
  let done = false
  await retryDb(() =>
    db.$transaction(async (tx) => {
      const claim = await tx.subscriptionPayment.updateMany({
        where: { id: subPaymentId, status: { in: ['REFUND_DUE', 'VERIFIED'] } },
        data: {
          status: 'REFUNDED',
          ...(data.refundUtr ? { refundUtr: data.refundUtr } : {}),
          ...(data.refundVpa ? { refundVpa: data.refundVpa } : {}),
        },
      })
      if (claim.count === 0) return
      done = true
    }, TX)
  )
  if (!done) return { ok: false, reason: 'already refunded' }
  await safeAudit({
    shopId: sp.shopId,
    userId: adminUserId,
    actorType: 'USER',
    action: 'SUBSCRIPTION_REFUNDED',
    entity: 'SubscriptionPayment',
    entityId: subPaymentId,
    meta: { refundUtr: data.refundUtr, refundVpa: data.refundVpa },
  })
  await retryDb(() =>
    db.notification
      .create({
        data: { shopId: sp.shopId, audience: 'SHOP', title: 'Plan payment refunded', body: 'Platform ne aapka payment wapas kar diya.' },
      })
      .catch(() => null)
  )
  return { ok: true }
}
