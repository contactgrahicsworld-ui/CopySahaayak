// YouPI PG webhook receiver — the single entry point for gateway payment
// confirmations. SECURITY-FIRST design:
//   1. HMAC-SHA256 over RAW bytes (v1) + timestamp-bound (v2), timing-safe.
//   2. deliveryId dedupe (gateway retries are byte-identical).
//   3. Order reference must be ORD-<Payment.id> or SUB-<SubscriptionPayment.id>
//      and the amount must equal the DB amount EXACTLY (paise precision).
//   4. Event filter: RECONCILED (statement-matched) always advances;
//      OBSERVED_SUCCESS (bank-alert) only when the platform opts in.
//   5. Every delivery is persisted (GatewayEvent) — accepted or not — so the
//      audit trail shows exactly what the gateway claimed and what we did.
//   6. Per-scope secret: ORD-* verifies against the SHOP's webhook secret,
//      SUB-* against the platform secret — a shop's gateway can never confirm
//      another shop's payment or a subscription.
import { NextResponse } from 'next/server'
import { db, retryDb } from '@/lib/db'
import { verifyWebhookSignature, parseWebhookPayload, isAcceptableGatewayEvent, getShopYoupiConfig, getPlatformYoupiConfig } from '@/lib/youpi'
import { advanceOrderPaymentByGateway, advanceSubscriptionByGateway } from '@/lib/gateway-verify'
import { rateLimitShared } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status })
}

export async function POST(req: Request) {
  // Generous but real rate limit: normal volume is a handful of webhooks.
  const ip = getClientIp(req)
  const rl = await rateLimitShared(`youpi-wh:${ip}`, 120, 5 * 60_000)
  if (!rl.allowed) return reply(429, { error: 'Too many requests' })

  const rawBody = await req.text()
  const headers = {
    signature: req.headers.get('x-gateway-signature'),
    signatureV2: req.headers.get('x-gateway-signature-v2'),
    event: req.headers.get('x-gateway-event'),
    deliveryId: req.headers.get('x-gateway-delivery-id'),
    timestamp: req.headers.get('x-gateway-timestamp'),
  }

  const payload = parseWebhookPayload(rawBody)
  if (!payload) return reply(400, { error: 'Body is not valid JSON' })

  const deliveryId = String(payload.deliveryId || headers.deliveryId || '')
  if (!deliveryId || deliveryId.length < 10 || deliveryId.length > 64) {
    return reply(400, { error: 'deliveryId missing/invalid' })
  }

  // Route by reference prefix, then verify with the matching scope's secret.
  const orderId = String(payload.orderId || '')
  const isOrder = orderId.startsWith('ORD-')
  const isSub = orderId.startsWith('SUB-')
  if (!isOrder && !isSub) return reply(400, { error: 'orderId must start with ORD- or SUB-' })
  const targetId = orderId.slice(4)

  const paymentRow = isOrder
    ? await retryDb(() => db.payment.findUnique({ where: { id: targetId }, select: { shopId: true, amountPaise: true } }))
    : null
  const subRow = isSub
    ? await retryDb(() => db.subscriptionPayment.findUnique({ where: { id: targetId }, select: { shopId: true, amountPaise: true } }))
    : null
  if (!paymentRow && !subRow) return reply(404, { error: 'Unknown payment reference' })

  const shopId = paymentRow?.shopId || subRow?.shopId
  if (!shopId) return reply(500, { error: 'Payment has no shop' })
  const cfg = isOrder ? await getShopYoupiConfig(shopId) : await getPlatformYoupiConfig()
  if (!cfg) {
    await recordEvent(deliveryId, payload, headers.event, isOrder, targetId, false, 'gateway not configured for this scope', rawBody)
    return reply(409, { error: 'Gateway not configured for this scope' })
  }

  const sig = verifyWebhookSignature(rawBody, cfg.webhookSecret, headers)
  if (!sig.ok) {
    // Rejected deliveries are recorded but must NEVER poison the dedupe key:
    // a forged attempt cannot block the gateway's real retry of the same
    // deliveryId. (Unique-conflicts on repeat rejects are swallowed.)
    await recordEvent(deliveryId, payload, headers.event, isOrder, targetId, false, `signature: ${sig.reason}`, rawBody)
    return reply(401, { error: 'Invalid webhook signature' })
  }

  // Dedupe AFTER signature verification, and only on ACCEPTED deliveries:
  // the gateway retries byte-identical payloads, so a processed deliveryId is
  // answered without re-advancing the payment.
  const existing = await retryDb(() => db.gatewayEvent.findUnique({ where: { deliveryId } }))
  if (existing?.accepted) return reply(200, { ok: true, deduped: true, accepted: true })

  // Event acceptance filter (owner-controlled trust level).
  const verdict = isAcceptableGatewayEvent(payload, cfg.acceptObserved)
  if (!verdict.ok) {
    await recordEvent(deliveryId, payload, headers.event, isOrder, targetId, false, verdict.reason, rawBody)
    // 200 with accepted:false — the gateway should NOT retry a rejected event.
    return reply(200, { ok: true, accepted: false, reason: verdict.reason })
  }

  // STRICT amount equality (gateway invariant: exact-match attribution).
  const expected = paymentRow?.amountPaise ?? subRow?.amountPaise
  const observedPaise = Number(payload.amountPaise ?? Math.round(Number(payload.amount || 0) * 100))
  if (!Number.isFinite(observedPaise) || observedPaise !== expected) {
    await recordEvent(deliveryId, payload, headers.event, isOrder, targetId, false, `amount mismatch: expected ${expected}, got ${observedPaise}`, rawBody)
    return reply(409, { error: 'Amount mismatch', expected, observed: observedPaise })
  }

  // Persist the delivery BEFORE advancing (crash-safe audit + dedupe anchor).
  // Upsert: if a rejected event was recorded earlier under the same deliveryId
  // (e.g. amount mismatch fixed by the operator), this delivery now wins.
  await retryDb(() =>
    db.gatewayEvent.upsert({
      where: { deliveryId },
      update: { accepted: true, reason: null },
      create: { deliveryId, event: String(payload.event || headers.event || ''), scope: isOrder ? 'ORDER' : 'SUBSCRIPTION', targetId, gatewayRef: payload.paymentId || null, amountPaise: observedPaise, utr: payload.utr || null, accepted: true, payloadJson: rawBody.slice(0, 20_000) },
    })
  )

  const meta = { gatewayRef: String(payload.paymentId || ''), utr: payload.utr || undefined, deliveryId }
  const result = isOrder
    ? await advanceOrderPaymentByGateway(targetId, meta)
    : await advanceSubscriptionByGateway(targetId, meta)

  return reply(200, { ok: true, accepted: result.advanced, reason: result.reason })
}

async function recordEvent(
  deliveryId: string,
  payload: { event?: string; paymentId?: string; amountPaise?: number; amount?: string; utr?: string },
  headerEvent: string | null | undefined,
  isOrder: boolean,
  targetId: string,
  accepted: boolean,
  reason: string | undefined,
  rawBody: string
) {
  await retryDb(() =>
    db.gatewayEvent
      .create({
        data: {
          deliveryId,
          event: String(payload.event || headerEvent || ''),
          scope: isOrder ? 'ORDER' : 'SUBSCRIPTION',
          targetId,
          gatewayRef: payload.paymentId || null,
          amountPaise: payload.amountPaise ?? (Number.isFinite(Number(payload.amount)) ? Math.round(Number(payload.amount) * 100) : null),
          utr: payload.utr || null,
          accepted,
          reason,
          payloadJson: rawBody.slice(0, 20_000),
        },
      })
      .catch(() => null)
  )
}
