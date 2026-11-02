// Forgot password step 2: verify the emailed 6-digit OTP with Supabase, then
// update our app password (bcrypt) and revoke every existing session.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { resetPasswordSchema } from '@/lib/validation'
import { bcryptHash } from '@/lib/security'
import { verifyEmailOtp, adminFindUserByEmail, adminUpdateUserPassword } from '@/lib/supabase'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/security'
import { audit } from '@/lib/audit'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const BAD_CODE = 'Invalid or expired code. Request a new one.'

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.authReset, bucket: 'reset' } },
    async () => {
      const body = resetPasswordSchema.parse(await req.json())
      const email = body.email.toLowerCase()

      // Server-side proof the code is real — Supabase checks it, we never trust the client.
      let codeOk = false
      let supabaseDown = false
      try {
        codeOk = await verifyEmailOtp(email, body.code)
      } catch {
        supabaseDown = true
      }
      if (supabaseDown) return jsonError(502, 'Password reset is temporarily unavailable. Please try again in a few minutes.')
      if (!codeOk) return jsonError(400, BAD_CODE)

      const user = await db.user.findUnique({ where: { email } })
      if (!user || !user.isActive) return jsonError(400, BAD_CODE)

      const passwordHash = await bcryptHash(body.password)
      await db.user.update({ where: { id: user.id }, data: { passwordHash } })
      // Invalidate every existing session of this user
      await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })

      // Keep the Supabase mirror in sync (best effort — it only exists for email OTP)
      const mirror = await adminFindUserByEmail(email).catch(() => null)
      if (mirror) {
        await adminUpdateUserPassword(mirror.id, crypto.randomBytes(24).toString('base64url')).catch(() => null)
      }

      await audit({ shopId: user.shopId, actorType: 'USER', userId: user.id, action: 'PASSWORD_RESET_COMPLETED', ip: getClientIp(req) })
      return jsonOk({ ok: true })
    }
  )
}
