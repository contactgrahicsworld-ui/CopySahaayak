// Self-service login-email change for SUPER_ADMIN and SHOP_ADMIN account
// owners. Guards:
//  - signed-in, active account required
//  - the CURRENT password must match (a stolen session alone cannot take over
//    the login identity)
//  - staff accounts cannot change their login email (owner-managed)
//  - the new email must not be registered to anyone else
// The Supabase auth mirror is moved to the new email so email-OTP password
// reset keeps working afterwards. The change is audit-logged with from/to.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getAuthedUser } from '@/lib/auth'
import { changeEmailSchema } from '@/lib/validation'
import { bcryptCompare, getClientIp } from '@/lib/security'
import { ensureSupabaseAuthUser, adminFindUserByEmail, adminDeleteUser } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.authReset, bucket: 'change-email' } },
    async () => {
      const ctx = await getAuthedUser()
      if (!ctx) return jsonError(401, 'Sign in required')
      if (ctx.user.role !== 'SUPER_ADMIN' && ctx.user.role !== 'SHOP_ADMIN') {
        return jsonError(403, 'Only the account owner can change the login email')
      }

      const body = changeEmailSchema.parse(await req.json())
      const newEmail = body.newEmail.toLowerCase()

      const user = await db.user.findUnique({ where: { id: ctx.user.id } })
      if (!user || !user.isActive) return jsonError(401, 'Sign in required')

      const passwordOk = await bcryptCompare(body.currentPassword, user.passwordHash)
      if (!passwordOk) return jsonError(400, 'Current password is incorrect')

      if (newEmail === user.email) return jsonError(400, 'This is already your login email')

      const taken = await db.user.findUnique({ where: { email: newEmail } })
      if (taken) return jsonError(409, 'This email is already registered to another account')

      const oldEmail = user.email
      await db.user.update({ where: { id: user.id }, data: { email: newEmail } })

      // Supabase mirror (best effort): mirror the new email so forgot-password
      // OTP keeps working, then remove the stale mirror for the old one.
      const oldMirror = await adminFindUserByEmail(oldEmail).catch(() => null)
      await ensureSupabaseAuthUser(newEmail)
      if (oldMirror) await adminDeleteUser(oldMirror.id).catch(() => null)

      await audit({
        shopId: user.shopId,
        userId: user.id,
        actorType: 'USER',
        action: 'LOGIN_EMAIL_CHANGED',
        entity: 'User',
        entityId: user.id,
        meta: { from: oldEmail, to: newEmail },
        ip: getClientIp(req),
      })
      return jsonOk({ ok: true, email: newEmail })
    }
  )
}
