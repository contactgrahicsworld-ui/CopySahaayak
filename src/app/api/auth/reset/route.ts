// Forgot password step 2: verify the emailed 6-digit code, then update the app
// password (bcrypt) and revoke every existing session. Verification path matches
// the transport used at step 1 (Supabase verify API or our hashed OTP table).
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { resetPasswordSchema } from '@/lib/validation'
import { bcryptHash } from '@/lib/security'
import { verifyEmailOtp, adminFindUserByEmail, adminUpdateUserPassword } from '@/lib/supabase'
import { mailTransport, hashOtp } from '@/lib/mailer'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/security'
import { audit } from '@/lib/audit'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const BAD_CODE = 'Invalid or expired code. Request a new one.'

async function verifySupabaseOtp(email: string, code: string): Promise<boolean> {
  try {
    return await verifyEmailOtp(email, code)
  } catch {
    throw new Error('supabase_down')
  }
}

async function verifyAppOtp(email: string, code: string): Promise<boolean> {
  const otp = await db.passwordResetOtp.findFirst({
    where: { email, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  if (!otp) return false
  if (otp.attempts >= 5) return false
  const ok = otp.codeHash === hashOtp(code)
  await db.passwordResetOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 }, consumedAt: ok ? new Date() : undefined } })
  return ok
}

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.authReset, bucket: 'reset' } },
    async () => {
      const body = resetPasswordSchema.parse(await req.json())
      const email = body.email.toLowerCase()

      // Server-side proof the code is real — we never trust the client.
      let codeOk = false
      let serviceDown = false
      if (mailTransport === 'supabase') {
        try {
          codeOk = await verifySupabaseOtp(email, body.code)
        } catch {
          serviceDown = true
        }
        // Fallback: WhatsApp-delivered app-issued codes (verifyAppOtp) when the
        // email code did not match — keeps both channels valid without weakening either.
        if (!codeOk && !serviceDown) {
          codeOk = await verifyAppOtp(email, body.code).catch(() => false)
        }
      } else if (mailTransport === 'resend' || mailTransport === 'mock') {
        codeOk = await verifyAppOtp(email, body.code)
      } else {
        return jsonError(
          503,
          'Password reset email is not configured on this deployment yet. Ask the platform admin to set RESEND_API_KEY (or Supabase keys), or use the Super Admin password reset in the dashboard.'
        )
      }
      if (serviceDown) return jsonError(502, 'Password reset is temporarily unavailable. Please try again in a few minutes.')
      if (!codeOk) return jsonError(400, BAD_CODE)

      const user = await db.user.findUnique({ where: { email } })
      if (!user || !user.isActive) return jsonError(400, BAD_CODE)

      const passwordHash = await bcryptHash(body.password)
      await db.user.update({ where: { id: user.id }, data: { passwordHash } })
      // Invalidate every existing session of this user
      await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
      // Any app-issued codes are now worthless
      await db.passwordResetOtp.updateMany({ where: { email, consumedAt: null }, data: { consumedAt: new Date() } })

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
