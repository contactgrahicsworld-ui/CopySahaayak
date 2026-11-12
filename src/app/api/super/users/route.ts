// Super Admin directory for the platform admin + guaranteed password recovery
// path. The GET list contains ONLY active SUPER_ADMIN accounts (the Users tab
// is the platform-owner view; shop users are managed from the Shops tab). The
// super admin can reset their OWN password here — this is the always-available
// fallback when no email provider is configured. Every action is audit-logged;
// reset revokes all sessions.
import { db, TX } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { superResetPasswordSchema, superHandoverSchema, superDeleteUserSchema } from '@/lib/validation'
import { bcryptHash, bcryptCompare, getClientIp } from '@/lib/security'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const url = new URL(req.url)
    const q = url.searchParams.get('q')?.trim()
    // Users tab shows ONLY the active platform admin(s) (owner request: "jo
    // active admin ho wo hi dikhe, baaki total hata do"). Shop owners/staff
    // belong to the Shops tab and never appear here.
    const users = await db.user.findMany({
      where: {
        role: 'SUPER_ADMIN',
        isActive: true,
        ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : {}),
      },
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

// DELETE a SUPER_ADMIN account (Users tab "Delete" button — "at a time 1 hi
// admin ho"). The CALLER's own password confirms the action, so a stolen
// session alone can never delete a platform owner. Rules:
//  - target must be a SUPER_ADMIN (shop users are managed from the Shops tab)
//  - deleting ANOTHER super keeps the caller as the single remaining admin
//  - deleting YOURSELF as the last active super returns the platform to the
//    one-time /setup recovery state (same break-glass contract as the reset:
//    platform UPI cleared, pending platform transfers cancelled, shops and all
//    business data untouched) — the owner then self-creates a fresh account
export async function DELETE(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const body = superDeleteUserSchema.parse(await req.json())

    const target = await db.user.findUnique({ where: { id: body.userId } })
    if (!target) return jsonError(404, 'User not found')
    if (target.role !== 'SUPER_ADMIN') {
      return jsonError(400, 'Only Super Admin accounts are deleted here. Shop users are managed from the Shops tab.')
    }

    const caller = await db.user.findUnique({ where: { id: ctx.user.id } })
    if (!caller) return jsonError(401, 'Session user not found')
    const passwordOk = await bcryptCompare(body.password, caller.passwordHash)
    if (!passwordOk) {
      await audit({
        userId: ctx.user.id,
        actorType: 'USER',
        action: 'SUPER_ADMIN_DELETE_DENIED',
        entity: 'User',
        entityId: target.id,
        ip: getClientIp(req),
      })
      return jsonError(401, 'Password incorrect — delete aborted')
    }

    const isSelf = target.id === ctx.user.id
    const activeSupers = await db.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })
    // The deleted account is the last ACTIVE platform owner → /setup re-opens.
    const lastActive = target.isActive && activeSupers <= 1

    await db.$transaction(async (tx) => {
      // Full removal: the account row goes away and sessions cascade with it;
      // audit history survives via SET NULL, shops are never touched.
      await tx.user.delete({ where: { id: target.id } })
      if (lastActive) {
        await tx.platformSetting.upsert({ where: { key: 'super_admin_upi_vpa' }, update: { value: '' }, create: { key: 'super_admin_upi_vpa', value: '' } })
        await tx.platformSetting.upsert({ where: { key: 'super_admin_payee_name' }, update: { value: 'CopySahaayak Platforms' }, create: { key: 'super_admin_payee_name', value: 'CopySahaayak Platforms' } })
        await tx.authorityTransfer.updateMany({ where: { scope: 'PLATFORM', status: 'PENDING' }, data: { status: 'CANCELLED' } })
      } else {
        // A remaining owner exists: only transfers initiated by the deleted
        // account become meaningless and are cancelled.
        await tx.authorityTransfer.updateMany({ where: { scope: 'PLATFORM', status: 'PENDING', fromUserId: target.id }, data: { status: 'CANCELLED' } })
      }
    })

    await audit({
      userId: isSelf ? null : ctx.user.id, // self-delete: row gone → SET NULL keeps history
      actorType: 'USER',
      action: 'SUPER_ADMIN_DELETED',
      entity: 'User',
      entityId: target.id,
      meta: { targetEmail: target.email, self: isSelf, lastActiveAdmin: lastActive },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, selfDeleted: isSelf, setupReopened: lastActive })
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
