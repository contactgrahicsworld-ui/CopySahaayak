// User directory for the platform admin + guaranteed password recovery path.
// The super admin can reset any user's password — this is the always-available
// fallback when no email provider is configured, mirroring standard SaaS admin
// panels. Every action is audit-logged; reset revokes all sessions.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { superResetPasswordSchema, superHandoverSchema } from '@/lib/validation'
import { bcryptHash, bcryptCompare, getClientIp } from '@/lib/security'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()
    const users = await db.user.findMany({
      where: q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        shop: { select: { id: true, name: true, slug: true } },
      },
    })
    return jsonOk({ users })
  })
}

export async function POST(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const body = superResetPasswordSchema.parse(await req.json())

    const target = await db.user.findUnique({ where: { id: body.userId } })
    if (!target) return jsonError(404, 'User not found')

    // A super admin cannot reset ANOTHER super admin's password — prevents
    // escalation; own account changes go through forgot-password/profile.
    if (target.role === 'SUPER_ADMIN' && target.id !== ctx.user.id) {
      return jsonError(403, 'Super admin passwords can only be changed by the account owner (use forgot password).')
    }

    const passwordHash = await bcryptHash(body.newPassword)
    await db.user.update({ where: { id: target.id }, data: { passwordHash } })
    await db.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } })

    await audit({
      shopId: target.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'ADMIN_PASSWORD_RESET',
      entity: 'User',
      entityId: target.id,
      meta: { targetEmail: target.email },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}

// Platform admin handover — the ONLY supported way a super admin account is
// removed. The active super admin deactivates THEMSELVES (password-confirmed,
// fully audited, every session revoked). This re-opens the one-time /setup
// endpoint so a completely fresh platform admin can be created with new
// credentials — no email/OTP dependency anywhere in the flow.
// Guards:
//  - requireSuper: an authenticated, active super admin session is mandatory
//  - password must match the CURRENT account (a stolen session alone cannot
//    lock out the real owner)
//  - only ever targets ctx.user.id (self) — no other user can be affected
export async function PATCH(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const body = superHandoverSchema.parse(await req.json())
    const target = await db.user.findUnique({ where: { id: ctx.user.id } })
    if (!target) return jsonError(404, 'User not found')

    const passwordOk = await bcryptCompare(body.password, target.passwordHash)
    if (!passwordOk) {
      await audit({
        userId: ctx.user.id,
        actorType: 'USER',
        action: 'SUPER_ADMIN_HANDOVER_FAILED',
        entity: 'User',
        entityId: target.id,
        ip: getClientIp(req),
      })
      return jsonError(401, 'Password incorrect — handover aborted')
    }

    await db.$transaction([
      db.user.update({ where: { id: target.id }, data: { isActive: false } }),
      db.session.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ])

    await audit({
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SUPER_ADMIN_DEACTIVATED',
      entity: 'User',
      entityId: target.id,
      meta: { email: target.email, reason: 'handover to fresh platform admin' },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, setupReopened: true })
  })
}
