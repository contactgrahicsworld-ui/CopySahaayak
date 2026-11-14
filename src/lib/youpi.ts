// YouPI PG V2 merchant integration (self-hosted gateway).
//
// Trust model (from the gateway's own docs, enforced here):
//   - OBSERVED_SUCCESS = bank SMS/Gmail alert matched the exact amount
//     (settlementState: NOT_RECONCILED). Cryptographically signed, but the
//     gateway itself says this is not proof of settlement.
//   - RECONCILED = alert MATCHED against the operator-imported bank statement
//     (settlementState: RECONCILED). Strongest event the gateway can produce.
//   - The platform owner explicitly chose: gateway-verified = auto-advance.
//     Default acceptance = RECONCILED only. Accepting OBSERVED_SUCCESS is a
//     per-platform opt-in flag (`youpi_accept_observed`) because it is the
//     gateway's own recommendation to prefer statement-matched events.
//   - Manual UTR verification by the shop admin / super admin remains available
//     as a fallback and stays the source of truth for those flows.
//
// SECURITY: webhook HMAC-SHA256 over RAW bytes (v1) + timestamp-bound v2,
// timing-safe compares, deliveryId dedupe, strict amount equality, order
// reference must map to an actual Payment/SubscriptionPayment row.
import { db, retryDb } from '@/lib/db'
import { createHmac, timingSafeEqual } from 'crypto'

export type YoupiScopeConfig = {
  apiUrl: string
  merchantId: string
  apiKey: string
  webhookSecret: string
  publicKey: string
  acceptObserved: boolean
}

const SETTING_KEYS = {
  apiUrl: 'youpi_api_url',
  merchantId: 'youpi_merchant_id',
  apiKey: 'youpi_merchant_api_key',
  webhookSecret: 'youpi_webhook_secret',
  publicKey: 'youpi_public_key',
  acceptObserved: 'youpi_accept_observed',
} as const

export async function getPlatformYoupiConfig(): Promise<YoupiScopeConfig | null> {
  const rows = await retryDb(() => db.platformSetting.findMany({ where: { key: { in: Object.values(SETTING_KEYS) } } }))
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const apiUrl = (map[SETTING_KEYS.apiUrl] || '').trim()
  const apiKey = (map[SETTING_KEYS.apiKey] || '').trim()
  const webhookSecret = (map[SETTING_KEYS.webhookSecret] || '').trim()
  const merchantId = (map[SETTING_KEYS.merchantId] || '').trim()
  if (!apiUrl || !apiKey || !webhookSecret) return null
  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    merchantId,
    apiKey,
    webhookSecret,
    publicKey: (map[SETTING_KEYS.publicKey] || '').trim(),
    acceptObserved: map[SETTING_KEYS.acceptObserved] === '1',
  }
}

// A shop uses its OWN merchant credentials (registered on the owner's gateway
// instance with the SHOP's receiving VPA); apiUrl is shared from the platform.
export async function getShopYoupiConfig(shopId: string): Promise<YoupiScopeConfig | null> {
  const shop = await retryDb(() =>
    db.shop.findUnique({
      where: { id: shopId },
      select: { youpiEnabled: true, youpiMerchantId: true, youpiApiKey: true, youpiWebhookSecret: true, youpiPublicKey: true },
    })
  )
  if (!shop?.youpiEnabled || !shop.youpiApiKey || !shop.youpiWebhookSecret) return null
  const platform = await getPlatformYoupiConfig()
  if (!platform?.apiUrl) return null
  return {
    apiUrl: platform.apiUrl,
    merchantId: shop.youpiMerchantId || '',
    apiKey: shop.youpiApiKey,
    webhookSecret: shop.youpiWebhookSecret,
    publicKey: shop.youpiPublicKey || '',
    acceptObserved: platform.acceptObserved,
  }
}

export async function setPlatformYoupiSetting(key: string, value: string): Promise<void> {
  await retryDb(() =>
    db.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  )
}

export function youpiSettingKeys(): string[] {
  return Object.values(SETTING_KEYS)
}

// ---------- REST client ----------

export type CreatedSession = {
  paymentId: string
  orderId: string
  amount: string
  amountPaise: string
  currency: string
  status: string
  checkoutUrl: string
}

export async function createGatewaySession(
  cfg: YoupiScopeConfig,
  params: { orderId: string; amountPaise: number; returnUrl?: string; description?: string; idempotencyKey: string }
): Promise<CreatedSession> {
  const res = await fetch(`${cfg.apiUrl}/api/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.merchantId ? { 'X-Merchant-Id': cfg.merchantId } : {}),
      'X-Merchant-Key': cfg.apiKey,
      'Idempotency-Key': params.idempotencyKey,
    },
    body: JSON.stringify({
      orderId: params.orderId,
      amount: (params.amountPaise / 100).toFixed(2),
      currency: 'INR',
      ...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
      ...(params.description ? { metadata: { description: params.description } } : {}),
    }),
  })
  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`Gateway response not JSON (HTTP ${res.status})`)
  }
  if (!res.ok) {
    const msg = (body as { error?: string; message?: string })?.error || (body as { message?: string })?.message || text.slice(0, 200)
    throw new Error(`Gateway session create failed (HTTP ${res.status}): ${msg}`)
  }
  const b = body as Partial<CreatedSession>
  if (!b?.checkoutUrl || !b?.paymentId) throw new Error('Gateway session response incomplete (checkoutUrl/paymentId missing)')
  return b as CreatedSession
}

export async function getGatewayPayment(cfg: YoupiScopeConfig, paymentId: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${cfg.apiUrl}/api/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { 'X-Merchant-Key': cfg.apiKey, ...(cfg.merchantId ? { 'X-Merchant-Id': cfg.merchantId } : {}) },
  })
  if (!res.ok) return null
  return (await res.json()) as Record<string, unknown>
}

// ---------- Webhook verification ----------

export type WebhookHeaders = {
  signature?: string | null
  signatureV2?: string | null
  event?: string | null
  deliveryId?: string | null
  timestamp?: string | null
}

// Retries are byte-identical with the ORIGINAL timestamp; backoff runs up to
// ~1 hour, so the freshness window must cover that (2h chosen).
const TIMESTAMP_TOLERANCE_MS = 2 * 3600_000

function hexToBuf(hex: string): Buffer | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null
  return Buffer.from(hex, 'hex')
}

function safeEqualHex(expectedHex: string, provided: string | null | undefined): boolean {
  if (!provided) return false
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(provided)
  if (!m) return false
  const a = hexToBuf(expectedHex)
  const b = hexToBuf(m[1])
  if (!a || !b) return false
  return timingSafeEqual(a, b)
}

/**
 * Verifies both signature generations. At least V1 must match; if V2 is
 * present it MUST also match (a tampered timestamp can never pass V2).
 */
export function verifyWebhookSignature(
  rawBody: string,
  secret: string,
  headers: WebhookHeaders
): { ok: boolean; reason?: string } {
  const v1 = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  if (!safeEqualHex(v1, headers.signature)) {
    return { ok: false, reason: 'V1 signature mismatch' }
  }
  if (headers.signatureV2) {
    const ts = headers.timestamp || ''
    if (!/^\d{10,16}$/.test(ts)) return { ok: false, reason: 'V2 timestamp missing/invalid' }
    const v2 = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex')
    if (!safeEqualHex(v2, headers.signatureV2)) return { ok: false, reason: 'V2 signature mismatch' }
    const tsNum = Number(ts)
    if (Math.abs(Date.now() - tsNum) > TIMESTAMP_TOLERANCE_MS) {
      return { ok: false, reason: 'Timestamp outside freshness window' }
    }
  }
  return { ok: true }
}

export type GatewayWebhookPayload = {
  event?: string
  settlementState?: string
  method?: string
  orderId?: string
  amount?: string
  amountPaise?: number
  utr?: string
  paymentId?: string
  deliveryId?: string
  timestamp?: number
}

export function parseWebhookPayload(rawBody: string): GatewayWebhookPayload | null {
  try {
    const parsed = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as GatewayWebhookPayload
  } catch {
    return null
  }
}

export function isAcceptableGatewayEvent(payload: GatewayWebhookPayload, acceptObserved: boolean): { ok: boolean; reason?: string } {
  if (payload.method && payload.method !== 'UPI') {
    // COD / counter outcomes mean an order was placed, not that money arrived.
    return { ok: false, reason: `method ${payload.method} is not a UPI money event` }
  }
  const event = String(payload.event || '')
  if (event === 'RECONCILED') return { ok: true }
  if (event === 'OBSERVED_SUCCESS') {
    if (!acceptObserved) return { ok: false, reason: 'OBSERVED_SUCCESS not accepted (statement-matched RECONCILED required)' }
    return { ok: true }
  }
  return { ok: false, reason: `event ${event || '(none)'} is not a credit event` }
}
