// Interop test: CopySahaayak's webhook verification MUST accept exactly what
// YouPI's webhook-engine.js signs (V1 raw-body HMAC + V2 timestamp-bound HMAC),
// and MUST reject tampered payloads / stale timestamps / wrong secrets.
// Run: node scripts/test-youpi-hmac-interop.mjs
import { createHmac, timingSafeEqual } from 'crypto'

// Mirror of src/lib/youpi.ts verification (kept in sync manually).
const TIMESTAMP_TOLERANCE_MS = 2 * 3600_000
function safeEqualHex(expectedHex, provided) {
  if (!provided) return false
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(provided)
  if (!m) return false
  const a = Buffer.from(expectedHex, 'hex')
  const b = Buffer.from(m[1], 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
function verifyWebhookSignature(rawBody, secret, headers) {
  const v1 = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  if (!safeEqualHex(v1, headers.signature)) return { ok: false, reason: 'V1 mismatch' }
  if (headers.signatureV2) {
    const ts = headers.timestamp || ''
    if (!/^\d{10,16}$/.test(ts)) return { ok: false, reason: 'V2 timestamp invalid' }
    const v2 = createHmac('sha256', secret).update(`${ts}.${rawBody}`, 'utf8').digest('hex')
    if (!safeEqualHex(v2, headers.signatureV2)) return { ok: false, reason: 'V2 mismatch' }
    if (Math.abs(Date.now() - Number(ts)) > TIMESTAMP_TOLERANCE_MS) return { ok: false, reason: 'stale' }
  }
  return { ok: true }
}

// Mirror of the gateway's signing (packages/core/src/webhook-engine.js lines 215-222).
function signLikeGateway(rawBody, secret, timestamp) {
  const signature = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const timestampedSignature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')
  return {
    'X-Gateway-Signature': `sha256=${signature}`,
    'X-Gateway-Signature-V2': `sha256=${timestampedSignature}`,
    'X-Gateway-Timestamp': timestamp,
  }
}

let pass = 0, fail = 0
function check(name, ok) {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}

const secret = 'whsec_test_secret_0123456789abcdef'
const body = JSON.stringify({ event: 'RECONCILED', settlementState: 'RECONCILED', method: 'UPI', orderId: 'ORD-cmx123', amount: '499.00', amountPaise: 49900, utr: '402512345678', paymentId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', deliveryId: 'a1b2c3d4-1111-2222-3333-444455556666', timestamp: Date.now() })

const ts = String(Date.now())
const gw = signLikeGateway(body, secret, ts)
const sigs = { signature: gw['X-Gateway-Signature'], signatureV2: gw['X-Gateway-Signature-V2'], timestamp: gw['X-Gateway-Timestamp'] }

check('valid V1+V2 accepted', verifyWebhookSignature(body, secret, sigs).ok)
check('valid V1-only accepted', verifyWebhookSignature(body, secret, { signature: sigs.signature }).ok)
check('wrong secret rejected', !verifyWebhookSignature(body, 'whsec_wrong', sigs).ok)
const tampered = body.replace('499.00', '1.00')
const tamperedSigs = signLikeGateway(tampered, secret, ts)
check('tampered body rejected (orig sigs)', !verifyWebhookSignature(tampered, secret, sigs).ok)
const tamperedMapped = { signature: tamperedSigs['X-Gateway-Signature'], signatureV2: tamperedSigs['X-Gateway-Signature-V2'], timestamp: tamperedSigs['X-Gateway-Timestamp'] }
check('tampered body rejected (sigs made over tampered body)', !verifyWebhookSignature(body, secret, tamperedMapped).ok)
const staleTs = String(Date.now() - 3 * 3600_000)
const staleSigs = signLikeGateway(body, secret, staleTs)
check('stale timestamp (3h) rejected', !verifyWebhookSignature(body, secret, { signature: staleSigs['X-Gateway-Signature'], signatureV2: staleSigs['X-Gateway-Signature-V2'], timestamp: staleSigs['X-Gateway-Timestamp'] }).ok)
const oldTs = String(Date.now() - 1 * 3600_000)
const oldSigs = signLikeGateway(body, secret, oldTs)
check('1h-old timestamp (retry window) accepted', verifyWebhookSignature(body, secret, { signature: oldSigs['X-Gateway-Signature'], signatureV2: oldSigs['X-Gateway-Signature-V2'], timestamp: oldSigs['X-Gateway-Timestamp'] }).ok)
check('malformed signature rejected', !verifyWebhookSignature(body, secret, { signature: 'sha256=zzzz' }).ok)
check('missing signature rejected', !verifyWebhookSignature(body, secret, {}).ok)

// Event filter mirror
function isAcceptable(payload, acceptObserved) {
  if (payload.method && payload.method !== 'UPI') return { ok: false }
  const event = String(payload.event || '')
  if (event === 'RECONCILED') return { ok: true }
  if (event === 'OBSERVED_SUCCESS') return { ok: acceptObserved }
  return { ok: false }
}
check('RECONCILED accepted (strict)', isAcceptable({ event: 'RECONCILED', method: 'UPI' }, false).ok)
check('OBSERVED_SUCCESS rejected (strict)', !isAcceptable({ event: 'OBSERVED_SUCCESS', method: 'UPI' }, false).ok)
check('OBSERVED_SUCCESS accepted (fast mode)', isAcceptable({ event: 'OBSERVED_SUCCESS', method: 'UPI' }, true).ok)
check('COD (method=COD) never accepted', !isAcceptable({ event: 'SUCCESS', method: 'COD' }, true).ok)
check('EXPIRED never accepted', !isAcceptable({ event: 'EXPIRED', method: 'UPI' }, true).ok)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
