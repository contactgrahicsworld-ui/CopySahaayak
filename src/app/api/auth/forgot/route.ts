// Forgot password step 1: email a 6-digit one-time code.
// Transport priority: Supabase built-in mailer → Resend (RESEND_API_KEY) → mock
// (MAIL_MOCK=1, tests only). No user enumeration: unknown emails get the same
// response shape and timing as known ones.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { forgotPasswordSchema } from '@/lib/validation'
import { ensureSupabaseAuthUser, sendLoginOtp } from '@/lib/supabase'
import { mailTransport, sendMail, otpEmailTemplate, generateOtp, hashOtp } from '@/lib/mailer'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/security'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.authEmail, bucket: 'forgot' } },
    async () => {
      const { email: rawEmail } = forgotPasswordSchema.parse(await req.json())
      const email = rawEmail.toLowerCase()

      const user = await db.user.findUnique({ where: { email } })
      if (!user || !user.isActive) {
        // Same response shape and timing as the success path — no account discovery.
        return jsonOk({ ok: true, sent: true })
      }

      if (mailTransport === 'supabase') {
        const mirror = await ensureSupabaseAuthUser(email)
        if (!mirror) {
          return jsonError(502, 'Password reset is temporarily unavailable. Please try again in a few minutes.')
        }
        const result = await sendLoginOtp(email)
        if (!result.sent) {
          const waitMin = Math.max(1, Math.ceil((result.retryAfterSec || 300) / 60))
          return jsonError(429, `Reset email limit reached. Please try again in about ${waitMin} minute${waitMin > 1 ? 's' : ''}.`)
        }
      } else if (mailTransport === 'resend' || mailTransport === 'mock') {
        const code = generateOtp()
        const tpl = otpEmailTemplate(code)
        try {
          await sendMail({ to: email, ...tpl })
        } catch {
          return jsonError(502, 'Password reset is temporarily unavailable. Please try again in a few minutes.')
        }
        // Invalidate previous codes, then store the new one (hashed, 10-minute TTL).
        await db.passwordResetOtp.updateMany({
          where: { email, consumedAt: null },
          data: { consumedAt: new Date() },
        })
        await db.passwordResetOtp.create({
          data: { email, codeHash: hashOtp(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
        })
      } else {
        return jsonError(
          503,
          'Password reset email is not configured on this deployment yet. Ask the platform admin to set RESEND_API_KEY (or Supabase keys), or use the Super Admin password reset in the dashboard.'
        )
      }

      await audit({ shopId: user.shopId, actorType: 'SYSTEM', action: 'PASSWORD_RESET_REQUESTED', meta: { email }, ip: getClientIp(req) })
      return jsonOk({ ok: true, sent: true })
    }
  )
}
