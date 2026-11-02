// Forgot password step 1: email a 6-digit OTP via Supabase's built-in
// free-tier mailer. No user enumeration: unknown emails get the same response.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { forgotPasswordSchema } from '@/lib/validation'
import { ensureSupabaseAuthUser, sendLoginOtp } from '@/lib/supabase'
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

      const mirror = await ensureSupabaseAuthUser(email)
      if (!mirror) {
        return jsonError(502, 'Password reset is temporarily unavailable. Please try again in a few minutes.')
      }

      const result = await sendLoginOtp(email)
      if (!result.sent) {
        const waitMin = Math.max(1, Math.ceil((result.retryAfterSec || 300) / 60))
        return jsonError(429, `Reset email limit reached. Please try again in about ${waitMin} minute${waitMin > 1 ? 's' : ''}.`)
      }

      await audit({ shopId: user.shopId, actorType: 'SYSTEM', action: 'PASSWORD_RESET_REQUESTED', meta: { email }, ip: getClientIp(req) })
      return jsonOk({ ok: true, sent: true })
    }
  )
}
