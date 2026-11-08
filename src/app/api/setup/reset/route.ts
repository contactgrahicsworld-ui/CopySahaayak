// Break-glass Super Admin credential reset ("purana credential hata do").
// For the platform owner who has LOST access to the super admin account: with
// the deployment's SUPER_SETUP_RESET_KEY (a server-side env secret, never in
// the database) this endpoint:
//   1. deletes every SUPER_ADMIN account completely (old credentials, old
//      sessions — gone; shops, owners and business data are untouched)
//   2. clears any stale platform payment UPI the old admin had set
//   3. cancels pending platform authority transfers
//   4. issues a ONE-TIME, 15-minute claim token that unlocks POST /api/setup
//      exactly once — the fresh Super Admin is then created on the creation
//      page (/setup) with brand-new credentials.
// Guards: timing-safe key compare, strict rate limit, 404-when-unconfigured,
// fully audited. Wrong key costs the same response as no key.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { setupResetSchema } from '@/lib/validation'
import { getClientIp, randomToken, sha256, timingSafeEqualStr } from '@/lib/security'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const CLAIM_HASH = 'setup_claim_hash'
const CLAIM_EXPIRES = 'setup_claim_expires'
const CLAIM_TTL_MS = 15 * 60 * 1000

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.setupReset, bucket: 'setup-reset' } },
    async () => {
      const envKey = process.env.SUPER_SETUP_RESET_KEY || ''
      if (!envKey) return jsonError(404, 'Not found')

      const body = setupResetSchema.parse(await req.json())
      if (!timingSafeEqualStr(envKey, body.resetKey)) {
        await audit({ actorType: 'SYSTEM', action: 'SUPER_SETUP_RESET_DENIED', ip: getClientIp(req) })
        return jsonError(401, 'Invalid recovery key')
      }

      const supers = await db.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true, email: true } })
      const claimToken = randomToken(24)

      await db.$transaction(async (tx) => {
        // Complete credential removal: the accounts themselves are deleted
        // (sessions cascade away; audit rows keep their history via SET NULL).
        if (supers.length) {
          await tx.user.deleteMany({ where: { role: 'SUPER_ADMIN', id: { in: supers.map((s) => s.id) } } })
        }
        // Stale payment destination removed — the fresh admin sets a new UPI.
        await tx.platformSetting.upsert({ where: { key: 'super_admin_upi_vpa' }, update: { value: '' }, create: { key: 'super_admin_upi_vpa', value: '' } })
        await tx.platformSetting.upsert({ where: { key: 'super_admin_payee_name' }, update: { value: 'CopySahaayak Platforms' }, create: { key: 'super_admin_payee_name', value: 'CopySahaayak Platforms' } })
        // Pending platform transfers die with their authority.
        await tx.authorityTransfer.updateMany({ where: { scope: 'PLATFORM', status: 'PENDING' }, data: { status: 'CANCELLED' } })
        // The one-time claim token (hashed at rest, 15-minute life).
        await tx.platformSetting.upsert({ where: { key: CLAIM_HASH }, update: { value: sha256(claimToken) }, create: { key: CLAIM_HASH, value: sha256(claimToken) } })
        await tx.platformSetting.upsert({ where: { key: CLAIM_EXPIRES }, update: { value: new Date(Date.now() + CLAIM_TTL_MS).toISOString() }, create: { key: CLAIM_EXPIRES, value: new Date(Date.now() + CLAIM_TTL_MS).toISOString() } })
      })

      await audit({
        actorType: 'SYSTEM',
        action: 'SUPER_SETUP_RESET',
        entity: 'User',
        meta: { removedSupers: supers.length, claimTtlMinutes: CLAIM_TTL_MS / 60000 },
        ip: getClientIp(req),
      })
      return jsonOk({ ok: true, removedSupers: supers.length, claimToken })
    }
  )
}
