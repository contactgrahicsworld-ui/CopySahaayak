// Cryptography, secrets, signed URLs, request helpers.
import crypto from 'crypto'

// In production APP_SECRET MUST be set via env (deployment docs). Dev fallback is
// deterministic so sessions survive dev-server restarts, and flagged via flag.
const DEV_SECRET = 'dev-only-secret-do-not-use-in-production'
export const APP_SECRET = process.env.APP_SECRET || DEV_SECRET
export const IS_INSECURE_SECRET = !process.env.APP_SECRET

export const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex')

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function randomCode(len = 6): string {
  // Unambiguous alphabet (no 0/O/1/I)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const buf = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length]
  return out
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

// ---- Short-lived signed URLs for private files ----
export function signFileUrl(fileId: string, ttlMs: number): { exp: number; sig: string } {
  const exp = Date.now() + ttlMs
  const sig = crypto.createHmac('sha256', APP_SECRET).update(`${fileId}|${exp}`).digest('base64url')
  return { exp, sig }
}

export function verifyFileSignature(fileId: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false
  const expected = crypto.createHmac('sha256', APP_SECRET).update(`${fileId}|${expNum}`).digest('base64url')
  return timingSafeEqualStr(expected, sig)
}

// ---- Request helpers ----
export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

// CSRF defense: state-changing requests must originate from our own origin.
// SameSite=Lax cookies are the primary defense; this is the second layer.
//
// Proxy-aware: behind reverse proxies / preview tunnels the browser sends
// Origin: https://public-domain, while the app internally sees a different
// Host (e.g. an internal tunnel host). The public host is then advertised in
// a forwarded-style header — x-forwarded-host (standard proxies) or the
// platform's edge header. Accept an Origin matching ANY of these. Attacker
// pages cannot spoof this: browsers forbid setting Host/Origin, and custom
// headers trigger a CORS preflight this API never satisfies. Non-browser
// attackers have no ambient cookies to ride, so CSRF does not apply to them.
export function sameOriginOk(req: Request): boolean {
  const method = req.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  const origin = req.headers.get('origin')
  if (!origin) return true // native device clients / curl without Origin — auth still required
  try {
    const originHost = new URL(origin).host
    const accepted = new Set<string>()
    const directHost = req.headers.get('host')
    if (directHost) accepted.add(directHost)
    const forwarded = req.headers.get('x-forwarded-host')
    if (forwarded) {
      for (const h of forwarded.split(',')) {
        const trimmed = h.trim()
        if (trimmed) accepted.add(trimmed)
      }
    }
    const edge = req.headers.get('abc') // sandbox preview edge: first DNS label of the public host
    if (edge) {
      const e = edge.trim()
      if (e) {
        accepted.add(e)
        // e.g. abc=preview-chat-abc123 while Origin host=preview-chat-abc123.space-z.ai
        if (originHost === e || originHost.startsWith(`${e}.`)) {
          return true
        }
      }
    }
    return accepted.has(originHost)
  } catch {
    return false
  }
}

export function bcryptHash(password: string): Promise<string> {
  // bcryptjs — pure JS, 12 rounds
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bcrypt = require('bcryptjs') as typeof import('bcryptjs')
  return bcrypt.hash(password, 12)
}

export function bcryptCompare(password: string, hash: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bcrypt = require('bcryptjs') as typeof import('bcryptjs')
  return bcrypt.compare(password, hash)
}
