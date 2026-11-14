// Gateway-triggered auto-advance: when a signed YouPI webhook proves a credit,
// the payment workflow moves forward WITHOUT any admin action — exactly what
// the platform owner asked for ("verified jaise hi ho, auto aage ke process").
// The state machines mirror the manual verify paths byte-for-byte:
//   - Order payment  : Payment VERIFIED + Order CONFIRMED + print jobs fan-out
//   - Subscription   : SubscriptionPayment VERIFIED + plan activate/extend + shop reactivation
//
// CONCURRENCY (the "never fail in any condition" guarantee): the gateway sends
// MULTIPLE deliveries for the same money event (RECONCILED and, when opted in,
// OBSERVED_SUCCESS are separate deliveryIds; retries add more). Two of them can
// race through the webhook route in parallel. A plain read-then-write would let
// BOTH pass the "still PENDING" check under read-committed isolation and, for
// subscriptions, EXTEND THE PLAN EXPIRY TWICE for one payment. So the status
// transition is claimed with an atomic conditional UPDATE inside the
// transaction: exactly one concurrent caller gets count===1, everyone else
// gets count===0 and exits without side effects. Postgres re-evaluates the
// WHERE clause on the row lock holder, so this is race-free by construction.
//
// IDEMPOTENCY: replays hit the deliveryId dedupe in the webhook route first;
// even if they slip past it (different deliveryId for the same payment), the
// atomic claim below makes the second delivery a no-op.
//
// FAN-OUT RESILIENCE: print job fan-out runs AFTER the payment transaction
// commits (same as the manual verify path). If it failed there and the webhook
// answered 500, the gateway would retry — and the deliveryId dedupe would
// swallow the retry without ever re-running the fan-out, leaving a CONFIRMED
// order that never prints. So fan-out is retried here with backoff, and if it
// still fails the failure is loudly recorded (audit + shop notification +
// owner alert) instead of silently vanishing; the shop admin can re-fan-out
// with the existing ORDER_REQUEUE_JOBS action.
import { db, retryDb, TX } from '@/lib/db'
import { audit } from '@/lib/audit'
import { enqueuePrintJobs, ownerAlert } from '@/lib/orders'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function safeAudit(entry: Parameters<typeof audit>[0]): Promise<void> {
  try {
    await audit(entry)
  } catch (err) {
    console.error('gateway-verify: audit write failed (non-fatal)', err)
  }
}

export async function advanceOrderPaymentByGateway(paymentId: string, meta: { gatewayRef: string; utr?: string; deliveryId: string }): Promise<{ advanced: boolean; reason?: string; fanoutFailed?: boolean }> {
  const payment = await retryDb(() => db.payment.findUnique({ where: { id: paymentId }, include: { order: true } }))
  if (!payment) return { advanced: false, reason: 'payment not found' }
  // REJECTED is claimable too: the customer may pay through the still-open
  // hosted checkout AFTER a rejection/cancellation. When the signed gateway
  // event proves the money arrived for exactly this payment, it must be
  // honored — a customer who paid must never end up with nothing.
  if (!['PENDING', 'SUBMITTED', 'REJECTED'].includes(payment.status)) {
    return { advanced: false, reason: `payment already ${payment.status}` }
  }

  let claimed = false
  await retryDb(() =>
    db.$transaction(async (tx) => {
      // ATOMIC CLAIM: only the first concurrent caller flips PENDING/SUBMITTED
      // -> VERIFIED. Losers get count 0 and must not touch anything else.
      const claim = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: ['PENDING', 'SUBMITTED', 'REJECTED'] } },
        data: {
          status: 'VERIFIED',
          verifiedVia: 'GATEWAY',
          verifiedAt: new Date(),
          rejectionReason: null,
          gatewayRef: meta.gatewayRef,
          ...(meta.utr && !payment.utr ? { utr: meta.utr } : {}),
        },
      })
      if (claim.count === 0) return
      claimed = true
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      })
      await tx.paymentVerification.create({
        data: { paymentId, action: 'VERIFY', adminUserId: null, note: `Auto-verified via YouPI gateway (event ${meta.deliveryId})` },
      })
    }, TX)
  )
  if (!claimed) {
    // Someone else claimed this payment. If it is already VERIFIED via the
    // gateway, the claimer may have crashed between its transaction commit and
    // its fan-out (or the fan-out errored). enqueuePrintJobs is idempotent, so
    // re-running it here is a free self-heal for that window.
    const current = await retryDb(() =>
      db.payment.findUnique({ where: { id: paymentId }, select: { status: true, verifiedVia: true } })
    )
    if (current?.status === 'VERIFIED' && current.verifiedVia === 'GATEWAY') {
      try {
        await enqueuePrintJobs(payment.orderId)
      } catch (err) {
        console.error(`gateway-verify: healing fan-out failed for order ${payment.orderId}`, err)
      }
    }
    return { advanced: false, reason: 'payment already processed by another delivery' }
  }

  // Print jobs fan-out (idempotent) — outside the transaction like the manual
  // path. Retried because a silent failure here would leave a CONFIRMED order
  // that never prints, and the webhook dedupe would hide every retry.
  let fanoutFailed = false
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await enqueuePrintJobs(payment.orderId)
      fanoutFailed = false
      break
    } catch (err) {
      console.error(`gateway-verify: print fan-out attempt ${attempt}/3 failed for order ${payment.orderId}`, err)
      fanoutFailed = true
      if (attempt < 3) await sleep(750 * attempt)
    }
  }
  if (fanoutFailed) {
    // Loud, durable record of the failure — recovery path: shop admin's
    // "Requeue print" action on the order (ORDER_REQUEUE_JOBS).
    await safeAudit({
      shopId: payment.shopId,
      actorType: 'SYSTEM',
      action: 'PAYMENT_PRINT_FANOUT_FAILED',
      entity: 'Order',
      entityId: payment.orderId,
      meta: { orderNumber: payment.order.orderNumber, deliveryId: meta.deliveryId, error: 'fan-out failed after 3 attempts' },
    })
    await retryDb(() =>
      db.notification
        .create({
          data: {
            shopId: payment.shopId,
            audience: 'SHOP',
            title: `Action needed: print queue failed for ${payment.order.orderNumber}`,
            body: 'Payment is verified and the order is confirmed, but the print job could not be queued automatically. Open the order and press Requeue print.',
          },
        })
        .catch(() => null)
    )
  }

  await retryDb(() =>
    db.notification
      .create({
        data: { shopId: payment.shopId, audience: 'SHOP', title: `Payment verified (gateway) — ${payment.order.orderNumber}`, body: 'Print jobs have been queued to your connector' },
      })
      .catch(() => null)
  )
  const shopForWa = await retryDb(() => db.shop.findUnique({ where: { id: payment.shopId }, select: { whatsappNumber: true } })).catch(() => null)
  if (shopForWa) {
    try {
      ownerAlert(shopForWa, payment.order.orderNumber, 'Payment verified (gateway)', 'Print jobs queued to your connector')
    } catch (err) {
      console.error('gateway-verify: ownerAlert failed (non-fatal)', err)
    }
  }
  await safeAudit({
    shopId: payment.shopId,
    actorType: 'SYSTEM',
    action: 'PAYMENT_VERIFIED_GATEWAY',
    entity: 'Payment',
    entityId: paymentId,
    meta: { orderNumber: payment.order.orderNumber, utr: meta.utr, gatewayRef: meta.gatewayRef, deliveryId: meta.deliveryId, ...(fanoutFailed ? { fanoutFailed: true } : {}) },
  })
  return { advanced: true, ...(fanoutFailed ? { fanoutFailed: true } : {}) }
}

export async function advanceSubscriptionByGateway(subPaymentId: string, meta: { gatewayRef: string; utr?: string; deliveryId: string }): Promise<{ advanced: boolean; reason?: string }> {
  const payment = await retryDb(() => db.subscriptionPayment.findUnique({ where: { id: subPaymentId }, include: { plan: true, shop: true } }))
  if (!payment) return { advanced: false, reason: 'subscription payment not found' }
  // REJECTED is claimable too: a shop-cancelled or admin-rejected intent that
  // the gateway later proves was actually PAID must still activate — money
  // received can never be silently dropped because of an earlier status.
  if (!['PENDING', 'REJECTED'].includes(payment.status)) return { advanced: false, reason: `already ${payment.status}` }

  let expiresAt = new Date()
  let claimed = false
  await retryDb(() =>
    db.$transaction(async (tx) => {
      // ATOMIC CLAIM: two concurrent deliveries of the same money event can
      // never both pass this conditional update, so the plan expiry can never
      // be extended twice for one payment.
      const claim = await tx.subscriptionPayment.updateMany({
        where: { id: subPaymentId, status: { in: ['PENDING', 'REJECTED'] } },
        data: {
          status: 'VERIFIED',
          verifiedVia: 'GATEWAY',
          verifiedAt: new Date(),
          rejectionReason: null,
          gatewayRef: meta.gatewayRef,
          ...(meta.utr ? { utr: meta.utr } : {}),
        },
      })
      if (claim.count === 0) return
      claimed = true
      const existing = await tx.subscription.findUnique({ where: { shopId: payment.shopId } })
      const base = existing?.expiresAt && existing.expiresAt > new Date() ? existing.expiresAt : new Date()
      expiresAt = new Date(base.getTime() + payment.plan.durationDays * 86400000)
      if (existing) {
        await tx.subscription.update({
          where: { shopId: payment.shopId },
          data: { planId: payment.planId, status: 'ACTIVE', startsAt: existing.startsAt || new Date(), expiresAt },
        })
      } else {
        await tx.subscription.create({
          data: { shopId: payment.shopId, planId: payment.planId, status: 'ACTIVE', startsAt: new Date(), expiresAt },
        })
      }
      await tx.shop.update({ where: { id: payment.shopId }, data: { isActive: true } })
      await tx.notification.create({
        data: { shopId: payment.shopId, audience: 'SHOP', title: `${payment.plan.name} plan activated (gateway payment)`, body: `Valid until ${expiresAt.toLocaleDateString('en-IN')}` },
      })
    }, TX)
  )
  if (!claimed) return { advanced: false, reason: 'payment already processed by another delivery' }

  await safeAudit({
    shopId: payment.shopId,
    actorType: 'SYSTEM',
    action: 'SUBSCRIPTION_VERIFIED_GATEWAY',
    entity: 'SubscriptionPayment',
    entityId: subPaymentId,
    meta: { planCode: payment.plan.code, utr: meta.utr, gatewayRef: meta.gatewayRef, deliveryId: meta.deliveryId, expiresAt: expiresAt.toISOString() },
  })
  return { advanced: true }
}
