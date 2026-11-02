// Route handler helpers: consistent JSON errors, rate limiting, origin checks.
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { HttpError } from '@/lib/auth'
import { getClientIp, sameOriginOk } from '@/lib/security'
import { rateLimit } from '@/lib/rate-limit'

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, init)
}

export function jsonError(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra || {}) }, { status })
}

interface RouteOptions {
  rateLimit?: { max: number; windowMs: number; bucket: string }
  checkOrigin?: boolean
}

export async function handleRoute(
  req: Request,
  options: RouteOptions,
  fn: () => Promise<Response>
): Promise<Response> {
  try {
    if (options.checkOrigin !== false && !sameOriginOk(req)) {
      return jsonError(403, 'Cross-origin request rejected')
    }
    if (options.rateLimit) {
      const ip = getClientIp(req)
      const rl = rateLimit(`${options.rateLimit.bucket}:${ip}`, options.rateLimit.max, options.rateLimit.windowMs)
      if (!rl.allowed) {
        return jsonError(429, `Too many requests. Try again in ${rl.retryAfterSec}s`, { retryAfter: rl.retryAfterSec })
      }
    }
    return await fn()
  } catch (err) {
    if (err instanceof HttpError) return jsonError(err.status, err.message)
    if (err instanceof ZodError) {
      const first = err.issues[0]
      return jsonError(400, first ? `${first.path.join('.')}: ${first.message}` : 'Invalid input')
    }
    console.error('[api] unhandled error:', err)
    return jsonError(500, 'Internal server error')
  }
}

export function orderNumber(prefix: string): string {
  const d = new Date()
  const yymm = `${d.getFullYear().toString().slice(2)}${(d.getMonth() + 1).toString().padStart(2, '0')}`
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(5, 'X').slice(0, 5)
  return `${prefix}-${yymm}-${rand}`
}
