// PULL-BASED GATEWAY RECONCILIATION — the webhook-missed safety net.
//
// Failure mode this eliminates: the customer PAID on the hosted checkout, but
// the signed webhook never reached us (gateway downtime, network blip,
// misconfigured webhook, retry budget exhausted). Without this, money arrived
// yet the order stayed PENDING_PAYMENT forever and the plan never activated —
// a guaranteed "fail in some condition".
//
// Design:
//   - The customer's order tracker polls every 8 s and the admin dashboard
//     polls the subscription endpoint; these GET routes call the reconcile
//     helpers below when a payment is still open AND carries a gatewayRef
//     (i.e. a hosted checkout session was actually opened).
//   - TRUST RULES ARE IDENTICAL to the webhook path: the gateway REST response
//     must still pass isAcceptableGatewayEvent (RECONCILED always;
//     OBSERVED_SUCCESS only when the platform opted in) and the amount must
//     equal the DB amount EXACTLY. Pulling the status server-to-server with
//     the merchant API key is authenticated by the gateway, but the same
//     acceptance policy is applied so a pull can never advance on a weaker
//     signal than a webhook would need.
//   - THROTTLED: at most one gateway API call per payment per 20 s, anchored
//     on the gatewayCheckedAt column (works across serverless instances, not
//     just one warm lambda). The column is stamped even when the gateway is
//     unreachable so a dead gateway cannot turn into a per-8s hammering loop.
//   - NEVER THROWS: every error becomes a { checked:false, reason } result.
//     The polling endpoint must keep working even when the gateway is down.
import { db, retryDb } from '@/lib/db'
import {
  getShopYoupiConfig,
  getPlatformYoupiConfig,
  getGatewayPayment,
  isAcceptableGatewayEvent,
  type GatewayWebhookPayload,
} from '@/lib/youpi'
import { advanceOrderPaymentByGateway, advanceSubscriptionByGateway } from '@/lib/gateway-verify'

export const RECONCILE_THROTTLE_MS = 20_000

export type ReconcileResult = {
  checked: boolean // did we actually call the gateway (passed the throttle)?
  advanced: boolean // did the payment advance as a result?
  reason?: string
}

function throttleDue(last: Date | null | undefined): boolean {
  return !last || Date.now() - last.getTime() >= RECONCILE_THROTTLE_MS
}

/**
 * The gateway's GET /api/v1/payments/:id response shape is operator-defined;
 * map it tolerantly onto the same fields the webhook payload uses. A response
 * that lacks any recognizable credit-event fields simply fails acceptance —
 * it can never be interpreted as money received.
 */
function payloadFromGatewayPayment(resp: Record<string, unknown>): GatewayWebhookPayload | null {
  if (!resp || typeof resp !== 'object') return null
  const obj = resp as Record<string, unknown>
  const num = (v: unknown): number | undefined => {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

  const event = str(obj.event) || str(obj.status) || str(obj.settlementState)
  if (!event) return null
  const amountNum = num(obj.amount)
  const amountPaise = num(obj.amountPaise) ?? (amountNum !== undefined ? Math.round(amountNum * 100) : undefined)
  return {
    event,
    settlementState: str(obj.settlementState) || (event === 'RECONCILED' ? 'RECONCILED' : undefined),
    method: str(obj.method),
    amountPaise,
    amount: str(obj.amount),
    utr: str(obj.utr),
    paymentId: str(obj.paymentId) || str(obj.id),
  }
}

export async function reconcileOrderPaymentFromGateway(paymentId: string): Promise<ReconcileResult> {
  const payment = await retryDb(() =>
    db.payment.findUnique({ where: { id: paymentId }, select: { id: true, shopId: true, status: true, amountPaise: true, gatewayRef: true, gatewayCheckedAt: true } })
  ).catch(() => null)
  if (!payment) return { checked: false, advanced: false, reason: 'payment not found' }
  if (!['PENDING', 'SUBMITTED'].includes(payment.status) || !payment.gatewayRef) {
    return { checked: false, advanced: false, reason: 'nothing to reconcile' }
  }
  if (!throttleDue(payment.gatewayCheckedAt)) {
    return { checked: false, advanced: false, reason: 'throttled' }
  }

  const cfg = await getShopYoupiConfig(payment.shopId).catch(() => null)
  if (!cfg) return { checked: false, advanced: false, reason: 'gateway not configured' }

  // Stamp the throttle BEFORE the network call: a slow/hanging gateway must
  // not cause overlapping checks from parallel polls.
  await retryDb(() => db.payment.update({ where: { id: payment.id }, data: { gatewayCheckedAt: new Date() } })).catch(() => null)

  let resp: Record<string, unknown> | null = null
  try {
    resp = await getGatewayPayment(cfg, payment.gatewayRef)
  } catch (err) {
    console.error('gateway-reconcile: order status fetch failed', err)
    return { checked: true, advanced: false, reason: 'gateway unreachable' }
  }
  if (!resp) return { checked: true, advanced: false, reason: 'gateway unknown payment' }

  const payload = payloadFromGatewayPayment(resp)
  if (!payload) return { checked: true, advanced: false, reason: 'gateway response has no recognizable event fields' }

  const verdict = isAcceptableGatewayEvent(payload, cfg.acceptObserved)
  if (!verdict.ok) return { checked: true, advanced: false, reason: `not a credit event: ${verdict.reason}` }

  const observedPaise = payload.amountPaise
  if (!Number.isFinite(observedPaise) || observedPaise !== payment.amountPaise) {
    return { checked: true, advanced: false, reason: `amount mismatch: expected ${payment.amountPaise}, got ${observedPaise}` }
  }

  const result = await advanceOrderPaymentByGateway(paymentId, {
    gatewayRef: String(payload.paymentId || payment.gatewayRef),
    utr: payload.utr,
    deliveryId: `pull-${payment.gatewayRef}-${observedPaise}`,
  }).catch((err) => {
    console.error('gateway-reconcile: order advance failed', err)
    return { advanced: false, reason: 'advance error' }
  })
  return { checked: true, advanced: result.advanced, reason: result.reason }
}

export async function reconcileSubscriptionPaymentFromGateway(subPaymentId: string): Promise<ReconcileResult> {
  const sp = await retryDb(() =>
    db.subscriptionPayment.findUnique({ where: { id: subPaymentId }, select: { id: true, shopId: true, status: true, amountPaise: true, gatewayRef: true, gatewayCheckedAt: true } })
  ).catch(() => null)
  if (!sp) return { checked: false, advanced: false, reason: 'payment not found' }
  if (sp.status !== 'PENDING' || !sp.gatewayRef) {
    return { checked: false, advanced: false, reason: 'nothing to reconcile' }
  }
  if (!throttleDue(sp.gatewayCheckedAt)) {
    return { checked: false, advanced: false, reason: 'throttled' }
  }

  const cfg = await getPlatformYoupiConfig().catch(() => null)
  if (!cfg) return { checked: false, advanced: false, reason: 'gateway not configured' }

  await retryDb(() => db.subscriptionPayment.update({ where: { id: sp.id }, data: { gatewayCheckedAt: new Date() } })).catch(() => null)

  let resp: Record<string, unknown> | null = null
  try {
    resp = await getGatewayPayment(cfg, sp.gatewayRef)
  } catch (err) {
    console.error('gateway-reconcile: subscription status fetch failed', err)
    return { checked: true, advanced: false, reason: 'gateway unreachable' }
  }
  if (!resp) return { checked: true, advanced: false, reason: 'gateway unknown payment' }

  const payload = payloadFromGatewayPayment(resp)
  if (!payload) return { checked: true, advanced: false, reason: 'gateway response has no recognizable event fields' }

  const verdict = isAcceptableGatewayEvent(payload, cfg.acceptObserved)
  if (!verdict.ok) return { checked: true, advanced: false, reason: `not a credit event: ${verdict.reason}` }

  const observedPaise = payload.amountPaise
  if (!Number.isFinite(observedPaise) || observedPaise !== sp.amountPaise) {
    return { checked: true, advanced: false, reason: `amount mismatch: expected ${sp.amountPaise}, got ${observedPaise}` }
  }

  const result = await advanceSubscriptionByGateway(subPaymentId, {
    gatewayRef: String(payload.paymentId || sp.gatewayRef),
    utr: payload.utr,
    deliveryId: `pull-${sp.gatewayRef}-${observedPaise}`,
  }).catch((err) => {
    console.error('gateway-reconcile: subscription advance failed', err)
    return { advanced: false, reason: 'advance error' }
  })
  return { checked: true, advanced: result.advanced, reason: result.reason }
}
