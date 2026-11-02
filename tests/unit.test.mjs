// Unit tests for pure business logic — run: bun test tests/unit.test.mjs
import { test, describe } from 'bun:test'
import assert from 'node:assert/strict'
import { buildUpiPayload } from '@/lib/upi'
import { computeSides, computeTotal } from '@/lib/pricing'
import { rateLimit } from '@/lib/rate-limit'
import { signFileUrl, verifyFileSignature, randomCode, sha256 } from '@/lib/security'
import { detectMagic } from '@/lib/storage'
import { formatInr } from '@/lib/constants'

// ---- Pricing ----
describe('computeSides', () => {
  test('full document when no range', () => {
    assert.equal(computeSides(12, null, null), 12)
  })
  test('page range is inclusive; out-of-domain values rejected', () => {
    assert.equal(computeSides(10, 3, 7), 5)
    assert.equal(computeSides(10, 3, 99), 8) // clamped to document end
    assert.equal(computeSides(10, 0, 99), -1) // below page 1 → invalid (API rejects earlier)
    assert.equal(computeSides(10, 8, 3), -1) // inverted → invalid
  })
})

describe('computeTotal (server-authoritative)', () => {
  test('simplex: ₹2/side × 10 sides × 2 copies = ₹40', () => {
    assert.equal(computeTotal(200, 150, false, 10, 2), 4000)
  })
  test('duplex uses duplex rate: ₹1.5 × 10 × 1 = ₹15', () => {
    assert.equal(computeTotal(200, 150, true, 10, 1), 1500)
  })
})

// ---- UPI payload ----
describe('buildUpiPayload', () => {
  test('contains VPA, amount, order ref, INR', () => {
    const p = buildUpiPayload({ vpa: 'shop@okhdfcbank', payeeName: 'Sharma Digital', amountPaise: 4250, txnRef: 'PC-2602-ABCDE', note: 'order PC-2602-ABCDE' })
    assert.ok(p.startsWith('upi://pay?'))
    assert.ok(p.includes('pa=shop%40okhdfcbank'))
    assert.ok(p.includes('am=42.50'))
    assert.ok(p.includes('tr=PC2602ABCDE'))
    assert.ok(p.includes('cu=INR'))
  })
  test('strips invalid txn-ref characters', () => {
    const p = buildUpiPayload({ vpa: 'a@b', payeeName: 'x', amountPaise: 100, txnRef: 'PC-2602-AB#12', note: 'n' })
    assert.ok(!p.includes('#'))
  })
})

// ---- Rate limiting ----
describe('rateLimit', () => {
  test('blocks after max and reports retryAfter', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < 3; i++) assert.equal(rateLimit(key, 3, 60000).allowed, true)
    const blocked = rateLimit(key, 3, 60000)
    assert.equal(blocked.allowed, false)
    assert.ok(blocked.retryAfterSec > 0)
  })
})

// ---- Signed file URLs ----
describe('signed URLs', () => {
  test('valid signature passes, tampered/expired fail', () => {
    const { exp, sig } = signFileUrl('doc123', 60_000)
    assert.equal(verifyFileSignature('doc123', String(exp), sig), true)
    assert.equal(verifyFileSignature('doc124', String(exp), sig), false)
    assert.equal(verifyFileSignature('doc123', String(Date.now() - 1000), sig), false)
    assert.equal(verifyFileSignature('doc123', String(exp), sig.slice(0, -2) + 'xx'), false)
  })
})

// ---- Magic byte detection ----
describe('detectMagic', () => {
  test('PDF', () => {
    const buf = Buffer.from('%PDF-1.7 fake body')
    assert.deepEqual(detectMagic(buf), { ok: true, mime: 'application/pdf' })
  })
  test('JPEG', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    assert.equal(detectMagic(buf).mime, 'image/jpeg')
  })
  test('PNG', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    assert.equal(detectMagic(buf).mime, 'image/png')
  })
  test('rejects executables / html', () => {
    assert.equal(detectMagic(Buffer.from('MZ fake exe')).ok, false)
    assert.equal(detectMagic(Buffer.from('<script>alert(1)</script>')).ok, false)
  })
})

// ---- Misc ----
describe('helpers', () => {
  test('randomCode is unambiguous 6-char A-Z0-9', () => {
    const code = randomCode(6)
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/)
  })
  test('formatInr', () => {
    assert.equal(formatInr(4250), '₹42.50')
    assert.equal(formatInr(4000), '₹40')
  })
  test('sha256 stable', () => {
    assert.equal(sha256('abc'), sha256('abc'))
    assert.notEqual(sha256('abc'), sha256('abd'))
  })
})
