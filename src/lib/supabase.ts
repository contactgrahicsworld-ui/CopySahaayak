// Server-side Supabase integration over plain fetch (no SDK dependency):
// Auth admin (mirror users) + built-in free-tier email OTP for password reset.
// NOTE: file storage moved to src/lib/filestore.ts (backend-switchable).
import crypto from 'crypto'

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const supabaseConfigured = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY)

function assertConfigured(): void {
  if (!supabaseConfigured) {
    throw new Error('Supabase is not configured: set SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  }
}

async function sbFetch(path: string, opts: { method?: string; key?: string; body?: Buffer | string; contentType?: string } = {}): Promise<{ status: number; body: Buffer; json: () => unknown }> {
  assertConfigured()
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: opts.method || 'GET',
    headers: {
      apikey: opts.key || SERVICE_KEY,
      Authorization: `Bearer ${opts.key || SERVICE_KEY}`,
      ...(opts.contentType ? { 'Content-Type': opts.contentType } : {}),
    },
    body: (typeof opts.body === 'string' ? opts.body : opts.body ? new Uint8Array(opts.body.buffer.slice(opts.body.byteOffset, opts.body.byteOffset + opts.body.byteLength) as ArrayBuffer) : undefined),
  })
  const buf = Buffer.from(await res.arrayBuffer())
  return { status: res.status, body: buf, json: () => { try { return JSON.parse(buf.toString('utf8')) } catch { return null } } }
}

// ============ AUTH ADMIN (service role) ============

export interface SupabaseUser {
  id: string
  email: string
}

export async function adminFindUserByEmail(email: string): Promise<SupabaseUser | null> {
  // NOTE: current Supabase (GoTrue) versions silently IGNORE the `email` filter
  // param on the list endpoint — it returns the first page of ALL users. Relying
  // on it made lookups fail once >50 mirror users existed (the target user fell
  // beyond page 1 and ensureSupabaseAuthUser then 502'd every OTP request).
  // Paginate with per_page=200 (GoTrue max) and match locally instead.
  const needle = email.toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const res = await sbFetch(`/auth/v1/admin/users?per_page=200&page=${page}`)
    if (res.status !== 200) return null
    const data = res.json() as { users?: Array<{ id: string; email: string }> } | null
    const users = data?.users || []
    const hit = users.find((u) => (u.email || '').toLowerCase() === needle)
    if (hit) return { id: hit.id, email: hit.email }
    if (users.length < 200) return null
  }
  return null
}

export async function adminCreateUser(email: string): Promise<SupabaseUser> {
  const res = await sbFetch(`/auth/v1/admin/users`, {
    method: 'POST',
    contentType: 'application/json',
    body: JSON.stringify({
      email: email.toLowerCase(),
      password: crypto.randomBytes(24).toString('base64url'),
      email_confirm: true, // mirrored app users confirm out-of-band; OTP login needs no confirmation
    }),
  })
  const data = res.json() as { id?: string; msg?: string; message?: string } | null
  if (res.status !== 200 || !data?.id) {
    throw new Error(`Supabase user create failed (${res.status}): ${String(data?.msg || data?.message || '').slice(0, 150)}`)
  }
  return { id: data.id, email: email.toLowerCase() }
}

/** Idempotent: returns the mirrored Supabase auth user for this email. Null when Supabase is unreachable/unconfigured. */
export async function ensureSupabaseAuthUser(email: string): Promise<SupabaseUser | null> {
  if (!supabaseConfigured) return null
  try {
    const existing = await adminFindUserByEmail(email)
    if (existing) return existing
    return await adminCreateUser(email)
  } catch {
    // Non-fatal: password reset simply cannot use email OTP if Supabase is down/paused.
    return null
  }
}

export async function adminUpdateUserPassword(supabaseId: string, password: string): Promise<boolean> {
  const res = await sbFetch(`/auth/v1/admin/users/${supabaseId}`, {
    method: 'PUT',
    contentType: 'application/json',
    body: JSON.stringify({ password }),
  })
  return res.status === 200
}

// ============ EMAIL OTP (built-in free-tier mailer, anon key) ============

export interface OtpSendResult {
  sent: boolean
  retryAfterSec?: number
}

/**
 * Sends a 6-digit one-time code to the email via Supabase's built-in mailer
 * (free tier). `create_user: false` — only mirrored (existing) users get mail.
 */
export async function sendLoginOtp(email: string): Promise<OtpSendResult> {
  const res = await sbFetch(`/auth/v1/otp`, {
    method: 'POST',
    key: ANON_KEY,
    contentType: 'application/json',
    body: JSON.stringify({ email: email.toLowerCase(), create_user: false }),
  })
  if (res.status === 200) return { sent: true }
  const retry = Number((res.json() as { retry_after?: number } | null)?.retry_after) || undefined
  return { sent: false, retryAfterSec: retry }
}

/** Server-side proof the code is valid. Returns true when Supabase accepts it. */
export async function verifyEmailOtp(email: string, token: string): Promise<boolean> {
  const res = await sbFetch(`/auth/v1/verify`, {
    method: 'POST',
    key: ANON_KEY,
    contentType: 'application/json',
    body: JSON.stringify({ type: 'email', email: email.toLowerCase(), token }),
  })
  return res.status === 200
}
