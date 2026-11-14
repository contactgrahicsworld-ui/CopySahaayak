// Gateway-triggered auto-advance: when a signed YouPI webhook proves a credit,
// the payment workflow moves forward WITHOUT any admin action — exactly what
// the platform owner asked for ("verified jaise hi ho, auto aage ke process").
// The state machines mirror the manual verify paths byte-for-byte:
//   - Order payment  : Payment VERIFIED + Order CONFIRMED + print jobs fan-out
//   - Subscription   : SubscriptionPayment VERIFIED + plan activate/extend + shop reactivation
// Idempotency: the caller dedupes webhook deliveries; these functions ALSO
// re-check the payment status inside the transaction, so a replay can never
// double-activate a plan or double-queue print jobs.
import { db, retryDb, TX } from '@/lib/db'
import { audit } from '@/lib/audit'
import { enqueuePrintJobs, ownerAlert } from '@/lib/orders'

export async function advanceOrderPaymentByGateway(paymentId: string, meta: { gatewayRef: string; utr?: string; deliveryId: string }): Promise<{ advanced: boolean; reason?: string }> {
  const payment = await retryDb(() => db.payment.findUnique({ where: { id: paymentId }, include: { order: true } }))
  if (!payment) return { advanced: false, reason: 'payment not found' }
  if (!['PENDING', 'SUBMITTED'].includes(payment.status)) {
    return { advanced: false, reason: `payment already ${payment.status}` }
  }

  await retryDb(() =>
    db.$transaction(async (tx) => {
      // Re-check inside the transaction (concurrent manual verify protection).
      const current = await tx.payment.findUnique({ where: { id: paymentId }, select: { status: true } })
      if (!current || !['PENDING', 'SUBMITTED'].includes(current.status)) return
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'VERIFIED',
          verifiedVia: 'GATEWAY',
          verifiedAt: new Date(),
          rejectionReason: null,
          gatewayRef: meta.gatewayRef,
          ...(meta.utr && !payment.utr ? { utr: meta.utr } : {}),
        },
      })
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: 'CONFIRMED', confirmedAt: new Date() },
      })
      await tx.paymentVerification.create({
        data: { paymentId, action: 'VERIFY', adminUserId: null, note: `Auto-verified via YouPI gateway (event ${meta.deliveryId})` },
      })
    }, TX)
  )

  // Print jobs fan-out (idempotent) — outside the transaction like the manual path.
  await enqueuePrintJobs(payment.orderId)
  await retryDb(() =>
    db.notification.create({
      data: { shopId: payment.shopId, audience: 'SHOP', title: `Payment verified (gateway) — ${payment.order.orderNumber}`, body: 'Print jobs have been queued to your connector' },
    })
  )
  const shopForWa = await retryDb(() => db.shop.findUnique({ where: { id: payment.shopId }, select: { whatsappNumber: true } }))
  if (shopForWa) ownerAlert(shopForWa, payment.order.orderNumber, 'Payment verified (gateway)', 'Print jobs queued to your connector')
  await audit({
    shopId: payment.shopId,
    actorType: 'SYSTEM',
    action: 'PAYMENT_VERIFIED_GATEWAY',
    entity: 'Payment',
    entityId: paymentId,
    meta: { orderNumber: payment.order.orderNumber, utr: meta.utr, gatewayRef: meta.gatewayRef, deliveryId: meta.deliveryId },
  })
  return { advanced: true }
}

export async function advanceSubscriptionByGateway(subPaymentId: string, meta: { gatewayRef: string; utr?: string; deliveryId: string }): Promise<{ advanced: boolean; reason?: string }> {
  const payment = await retryDb(() => db.subscriptionPayment.findUnique({ where: { id: subPaymentId }, include: { plan: true, shop: true } }))
  if (!payment) return { advanced: false, reason: 'subscription payment not found' }
  if (payment.status !== 'PENDING') return { advanced: false, reason: `already ${payment.status}` }

  let expiresAt = new Date()
  await retryDb(() =>
    db.$transaction(async (tx) => {
      const current = await tx.subscriptionPayment.findUnique({ where: { id: subPaymentId }, select: { status: true } })
      if (!current || current.status !== 'PENDING') return
      await tx.subscriptionPayment.update({
        where: { id: subPaymentId },
        data: {
          status: 'VERIFIED',
          verifiedVia: 'GATEWAY',
          verifiedAt: new Date(),
          rejectionReason: null,
          gatewayRef: meta.gatewayRef,
          ...(meta.utr ? { utr: meta.utr } : {}),
        },
      })
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

  await audit({
    shopId: payment.shopId,
    actorType: 'SYSTEM',
    action: 'SUBSCRIPTION_VERIFIED_GATEWAY',
    entity: 'SubscriptionPayment',
    entityId: subPaymentId,
    meta: { planCode: payment.plan.code, utr: meta.utr, gatewayRef: meta.gatewayRef, deliveryId: meta.deliveryId, expiresAt: expiresAt.toISOString() },
  })
  return { advanced: true }
}
