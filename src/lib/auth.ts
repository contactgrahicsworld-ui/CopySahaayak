// Authentication & authorization: admin users, guest customers, printer devices.
// Sessions are opaque random tokens stored hashed (sha256) in the DB — revocable,
// no JWT state to leak. Cookies are HttpOnly + SameSite=Lax.
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { COOKIES, LIMITS } from '@/lib/constants'
import { randomToken, sha256 } from '@/lib/security'
import type { User } from '@prisma/client'

// ============ Admin / staff users ============

export interface AuthedContext {
  user: Pick<User, 'id' | 'email' | 'name' | 'role' | 'shopId'>
}

export async function createAdminSession(userId: string, ip?: string, userAgent?: string): Promise<string> {
  const token = randomToken(32)
  await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      ip: ip || null,
      userAgent: userAgent?.slice(0, 300) || null,
      expiresAt: new Date(Date.now() + LIMITS.sessionTtlMs),
    },
  })
  return token
}

export async function getAuthedUser(): Promise<AuthedContext | null> {
  const store = await cookies()
  const raw = store.get(COOKIES.admin)?.value
  if (!raw) return null
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: true },
  })
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.isActive) return null
  // Daily-expiry policy, enforced retroactively: a session is only valid within
  // sessionTtlMs (24h) of its creation, regardless of the stored expiresAt.
  // Sessions issued before this policy (30-day TTL deployments) die instantly
  // instead of lingering for weeks on a forgotten PC or phone.
  if (session.createdAt.getTime() + LIMITS.sessionTtlMs < Date.now()) return null
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      shopId: session.user.shopId,
    },
  }
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies()
  const raw = store.get(COOKIES.admin)?.value
  if (raw) {
    await db.session.updateMany({ where: { tokenHash: sha256(raw) }, data: { revokedAt: new Date() } })
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIES.admin, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: LIMITS.sessionTtlMs / 1000,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIES.admin)
}

// ============ Guest customer sessions (per-shop, registration-free) ============

export async function getOrCreateCustomerSession(shopId: string, name?: string, phone?: string, ip?: string, ua?: string) {
  const store = await cookies()
  const cookieName = COOKIES.customer(shopId)
  const raw = store.get(cookieName)?.value
  if (raw) {
    const session = await db.customerSession.findUnique({ where: { tokenHash: sha256(raw) } })
    if (session && session.shopId === shopId) {
      await db.customerSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), ...(name ? { name } : {}), ...(phone ? { phone } : {}) },
      })
      return session
    }
  }
  const token = randomToken(24)
  const session = await db.customerSession.create({
    data: {
      shopId,
      tokenHash: sha256(token),
      name: name || null,
      phone: phone || null,
      ip: ip || null,
      userAgent: ua?.slice(0, 300) || null,
    },
  })
  store.set(cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: LIMITS.customerSessionTtlMs / 1000,
  })
  return session
}

export async function getCustomerSession(shopId: string) {
  const store = await cookies()
  const raw = store.get(COOKIES.customer(shopId))?.value
  if (!raw) return null
  const session = await db.customerSession.findUnique({ where: { tokenHash: sha256(raw) } })
  if (!session || session.shopId !== shopId) return null
  return session
}

// ============ Printer device auth (Windows connector) ============

export async function authenticateDevice(req: Request) {
  const header = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(header)
  if (!m) return null
  const device = await db.device.findUnique({
    where: { tokenHash: sha256(m[1]) },
    include: { shop: true },
  })
  if (!device || device.status !== 'ACTIVE' || !device.shop.isActive) return null
  return device
}

// ============ Route guards ============

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function requireSuper(): Promise<AuthedContext> {
  const ctx = await getAuthedUser()
  if (!ctx || ctx.user.role !== 'SUPER_ADMIN') throw new HttpError(403, 'Super admin access required')
  return ctx
}

// Shop-staff routes: resolves the caller's own shop (IDOR-safe: the shopId always
// comes from the session, never from client input).
export async function requireAnyShopAdmin(): Promise<AuthedContext & { user: { shopId: string } }> {
  const ctx = await getAuthedUser()
  if (!ctx) throw new HttpError(401, 'Authentication required')
  if (ctx.user.role !== 'SHOP_ADMIN' || !ctx.user.shopId) throw new HttpError(403, 'Shop admin access required')
  return ctx as AuthedContext & { user: { shopId: string } }
}

export async function requireShopAdmin(shopId: string): Promise<AuthedContext> {
  const ctx = await getAuthedUser()
  if (!ctx) throw new HttpError(401, 'Authentication required')
  const isSuper = ctx.user.role === 'SUPER_ADMIN'
  const ownsShop = ctx.user.role === 'SHOP_ADMIN' && ctx.user.shopId === shopId
  if (!isSuper && !ownsShop) throw new HttpError(403, 'Access denied for this shop')
  return ctx
}
