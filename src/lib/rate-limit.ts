// Fixed-window in-memory rate limiter (per IP + bucket).
// Single-instance deployments only — for horizontal scale swap with a Redis/DB backend.
// NOTE: stored on globalThis so bundlers (Turbopack/webpack) that duplicate this
// module across route bundles still share ONE map per process.
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
}

// Test isolation hook (dev/test only) — clears all buckets.
export function resetRateLimitsForTests(): void {
  buckets.clear()
}
