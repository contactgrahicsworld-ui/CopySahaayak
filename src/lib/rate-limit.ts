// Fixed-window rate limiter (per IP + bucket).
// - Security-critical buckets (login, OTP, register, uploads, orders, pairing)
//   are shared across serverless instances through the Postgres RateLimitEntry
//   table (atomic upsert). This survives Vercel's multi-instance fan-out.
// - Everything else stays in-memory (single instance/process).
// NOTE: the in-memory map lives on globalThis so bundlers (Turbopack/webpack)
// that duplicate this module across route bundles still share ONE map per process.
import { db } from '@/lib/db'

const _g = globalThis as unknown as { __pcsRateBuckets?: Map<string, { count: number; resetAt: number }>; __pcsRateSweep?: number }
const buckets = (_g.__pcsRateBuckets ||= new Map<string, { count: number; resetAt: number }>())

// Periodic cleanup so the map never grows unbounded
const SWEEP_INTERVAL = 10 * 60 * 1000
const lastSweepRef = { get: () => _g.__pcsRateSweep ?? 0, set: (v: number) => { _g.__pcsRateSweep = v } }

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

// Buckets that must count across ALL serverless instances.
const SHARED_BUCKETS = new Set([
  'login', 'register', 'submitUtr', 'upload', 'createOrder',
  'authEmail', 'authReset', 'pairing', 'change-password',
  'transfer', 'transfer-accept', 'setup-reset',
])

/** Atomic shared fixed-window increment. Null → DB layer unavailable, use memory. */
async function dbRateLimit(key: string, max: number, windowMs: number): Promise<RateLimitResult | null> {
  // Local SQLite dev databases don't have the csp schema — skip silently.
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) return null
  try {
    const now = new Date()
    const expires = new Date(now.getTime() + windowMs)
    const rows = await db.$queryRaw<Array<{ count: number; windowExpiresAt: Date }>>`
      INSERT INTO "csp"."RateLimitEntry" ("key", "count", "windowExpiresAt")
      VALUES (${key}, 1, ${expires})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "csp"."RateLimitEntry"."windowExpiresAt" < ${now} THEN 1 ELSE "csp"."RateLimitEntry"."count" + 1 END,
        "windowExpiresAt" = CASE WHEN "csp"."RateLimitEntry"."windowExpiresAt" < ${now} THEN ${expires} ELSE "csp"."RateLimitEntry"."windowExpiresAt" END
      RETURNING "count", "windowExpiresAt"`
    // Opportunistic garbage collection of expired windows (~2% of calls).
    if (Math.random() < 0.02) {
      db.$executeRaw`DELETE FROM "csp"."RateLimitEntry" WHERE "windowExpiresAt" < ${now}`.catch(() => {})
    }
    const row = rows[0]
    if (!row) return null
    const count = Number(row.count)
    const resetAtMs = new Date(row.windowExpiresAt).getTime()
    if (count > max) {
      return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000)) }
    }
    return { allowed: true, remaining: Math.max(0, max - count), retryAfterSec: 0 }
  } catch (err) {
    console.error('[rate-limit] shared limiter unavailable — falling back to in-memory:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function rateLimitShared(key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  const bucket = key.slice(0, key.indexOf(':'))
  if (SHARED_BUCKETS.has(bucket)) {
    const shared = await dbRateLimit(key, max, windowMs)
    if (shared) return shared
  }
  return rateLimit(key, max, windowMs)
}

export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  if (now - lastSweepRef.get() > SWEEP_INTERVAL) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k)
    lastSweepRef.set(now)
  }
  const entry = buckets.get(key)
  if (!entry || entry.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: max - 1, retryAfterSec: 0 }
  }
  if (entry.count >= max) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) }
  }
  entry.count++
  return { allowed: true, remaining: max - entry.count, retryAfterSec: 0 }
}

// Standard buckets used across the API
export const RATE_LIMITS = {
  login: { max: 10, windowMs: 15 * 60 * 1000 },
  upload: { max: 15, windowMs: 10 * 60 * 1000 },
  createOrder: { max: 12, windowMs: 10 * 60 * 1000 },
  submitUtr: { max: 20, windowMs: 60 * 60 * 1000 },
  readPublic: { max: 240, windowMs: 60 * 1000 },
  deviceApi: { max: 600, windowMs: 60 * 1000 },
  pairing: { max: 5, windowMs: 15 * 60 * 1000 },
  register: { max: 30, windowMs: 60 * 60 * 1000 },
  authEmail: { max: 12, windowMs: 60 * 60 * 1000 },
  authReset: { max: 12, windowMs: 60 * 60 * 1000 },
  transfer: { max: 6, windowMs: 60 * 60 * 1000 },
  transferAccept: { max: 10, windowMs: 60 * 60 * 1000 },
  setupReset: { max: 5, windowMs: 15 * 60 * 1000 },
}

// Test isolation hook (dev/test only) — clears all buckets.
export function resetRateLimitsForTests(): void {
  buckets.clear()
}

/** Dev/test helper: also wipes the shared Postgres limiter rows. Never exposed in production. */
export async function resetSharedRateLimitsForTests(): Promise<void> {
  resetRateLimitsForTests()
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.startsWith('file:')) return
  try {
    await db.$executeRaw`DELETE FROM "csp"."RateLimitEntry"`
  } catch {
    // ignore — test helper only
  }
}
