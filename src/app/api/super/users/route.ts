// User directory for the platform admin + guaranteed password recovery path.
// The super admin can reset any user's password — this is the always-available
// fallback when no email provider is configured, mirroring standard SaaS admin
// panels. Every action is audit-logged; reset revokes all sessions.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { superResetPasswordSchema } from '@/lib/validation'
import { bcryptHash, getClientIp } from '@/lib/security'
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
