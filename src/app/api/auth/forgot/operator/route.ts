// Break-glass password recovery WITHOUT email delivery.
// The SUPER_SETUP_RESET_KEY holder (the platform operator — same trust level
// as the /super setup recovery) claims a 6-digit app-issued OTP in-channel:
// the server returns the code directly in the response instead of emailing it.
// Rationale: Supabase's built-in free-tier mailer is rate-limited/unreliable,
// so forgot-password must never dead-end. Security properties:
//   • resetKey verified with a timing-safe compare against the env secret
//   • OTP is hashed at rest, single-consumption, 10-minute TTL, 5 attempts
//   • same shared Postgres rate-limit family as setup-reset (5 / 15 min / IP)
//   • audited (PASSWORD_RESET_OTP_CLAIMED)
// The key holder is the operator, so disclosing "no active account" is fine.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { operatorForgotSchema } from '@/lib/validation'
import { timingSafeEqualStr, getClientIp } from '@/lib/security'
import { generateOtp, hashOtp } from '@/lib/mailer'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.operatorOtp, bucket: 'operator-otp' } },
    async () => {
      const { email: rawEmail, resetKey } = operatorForgotSchema.parse(await req.json())
      const email = rawEmail.toLowerCase()

      const envKey = process.env.SUPER_SETUP_RESET_KEY || ''
      if (!envKey) {
        return jsonError(503, 'Operator recovery is not configured on this deployment (SUPER_SETUP_RESET_KEY missing).')
      }
      if (!timingSafeEqualStr(envKey, resetKey)) {
        return jsonError(401, 'Invalid recovery key')
      }

      const user = await db.user.findUnique({ where: { email } })
      if (!user || !user.isActive) {
        // Operator-only endpoint: the reset-key holder may know account existence.
        return jsonError(404, 'Is email par koi active account nahi mila. Account pehle create karo (ya spelling check karo).')
      }

      // Invalidate previous codes, then issue the new one (hashed, 10-minute TTL).
      await db.passwordResetOtp.updateMany({
        where: { email, consumedAt: null },
        data: { consumedAt: new Date() },
      })
      const code = generateOtp()
      await db.passwordResetOtp.create({
        data: { email, codeHash: hashOtp(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      })

      await audit({
        shopId: user.shopId,
        actorType: 'SYSTEM',
        action: 'PASSWORD_RESET_OTP_CLAIMED',
        meta: { email, channel: 'operator-reset-key' },
        ip: getClientIp(req),
      })
      return jsonOk({ ok: true, code })
    }
  )
}
