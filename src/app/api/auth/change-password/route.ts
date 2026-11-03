// Self-service password change for signed-in admins (super + shop).
// Requires the CURRENT password — proves ownership without email. The new
// password must satisfy the same policy as registration. All sessions are
// revoked afterwards (the caller signs back in with the new password), and
// the change is audit-logged.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getAuthedUser } from '@/lib/auth'
import { z } from 'zod'
import { newPasswordSchema } from '@/lib/validation'
import { bcryptHash, bcryptCompare, getClientIp } from '@/lib/security'
import { audit } from '@/lib/audit'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: newPasswordSchema,
})

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.authReset, bucket: 'change-password' } },
    async () => {
      const ctx = await getAuthedUser()
      if (!ctx) return jsonError(401, 'Sign in required')

      const body = schema.parse(await req.json())
      const user = await db.user.findUnique({ where: { id: ctx.user.id } })
      if (!user || !user.isActive) return jsonError(401, 'Sign in required')

      const ok = await bcryptCompare(body.currentPassword, user.passwordHash)
      if (!ok) return jsonError(400, 'Current password is incorrect')

      const same = await bcryptCompare(body.newPassword, user.passwordHash)
      if (same) return jsonError(400, 'New password must be different from the current one')

      const passwordHash = await bcryptHash(body.newPassword)
      await db.user.update({ where: { id: user.id }, data: { passwordHash } })
      await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })

      await audit({
        shopId: user.shopId,
        userId: user.id,
        actorType: 'USER',
        action: 'PASSWORD_CHANGED',
        entity: 'User',
        entityId: user.id,
        meta: { email: user.email },
        ip: getClientIp(req),
      })
      return jsonOk({ ok: true, signedOut: true })
    }
  )
}
