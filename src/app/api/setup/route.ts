// One-time platform setup: creates the FIRST Super Admin.
// First run (a platform has never had a super admin): open to anyone — no
// predefined credentials ship with the app.
// Ever after (tombstone `super_setup_used` exists): setup is PERMANENTLY locked.
// A forgotten/lost super admin is recovered through the break-glass endpoint
// POST /api/setup/reset, which requires the deployment's SUPER_SETUP_RESET_KEY
// env secret and issues a single-use, 15-minute CLAIM TOKEN. Setup then accepts
// exactly one creation while that token is valid — the page is never publicly
// re-openable, so no stranger can race in and claim the platform.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { setupSchema } from '@/lib/validation'
import { bcryptHash, getClientIp, sha256, timingSafeEqualStr } from '@/lib/security'
import { ensurePlatformBootstrap } from '@/lib/bootstrap'
import { ensureSupabaseAuthUser } from '@/lib/supabase'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const TOMBSTONE = 'super_setup_used'
const CLAIM_HASH = 'setup_claim_hash'
const CLAIM_EXPIRES = 'setup_claim_expires'

async function platformSetting(key: string): Promise<string | null> {
  const row = await db.platformSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'setup-view' } }, async () => {
    const [supers, used] = await Promise.all([
      db.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } }),
      platformSetting(TOMBSTONE),
    ])
    return jsonOk({ setupDone: supers > 0, recoveryRequired: Boolean(used) && supers === 0 })
  })
}

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.pairing, bucket: 'setup' } },
    async () => {
      const [activeSupers, used] = await Promise.all([
        db.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } }),
        platformSetting(TOMBSTONE),
      ])
      if (activeSupers > 0) return jsonError(403, 'Setup is already completed. Please sign in instead.')

      const body = setupSchema.parse(await req.json())
      const email = body.email.toLowerCase()

      let claimValid = false
      if (used) {
        // A platform that has had a super admin before: creation only with a
        // valid, unexpired claim token from the break-glass reset endpoint.
        if (!body.claimToken) {
          return jsonError(403, 'Recovery key required. Use the emergency recovery on this page (SUPER_SETUP_RESET_KEY) to unlock one-time setup.')
        }
        const storedHash = await platformSetting(CLAIM_HASH)
        const expiresAt = await platformSetting(CLAIM_EXPIRES)
        claimValid = Boolean(
          storedHash &&
          expiresAt &&
          timingSafeEqualStr(storedHash, sha256(body.claimToken)) &&
          new Date(expiresAt) > new Date()
        )
        if (!claimValid) return jsonError(403, 'Recovery claim is invalid or expired. Run the emergency recovery again.')
      }

      const dupe = await db.user.findUnique({ where: { email } })
      if (dupe) return jsonError(409, 'This email is already registered. Please sign in.')

      await ensurePlatformBootstrap()
      const user = await db.user.create({
        data: {
          email,
          passwordHash: await bcryptHash(body.password),
          name: body.name,
          phone: body.phone || null,
          role: 'SUPER_ADMIN',
          shopId: null,
        },
      })
      // Persist the platform UPI where all shop-owner plan payments will be
      // collected — captured at first-run so subscription billing works from day one.
      if (body.upiVpa) {
        await db.platformSetting.upsert({
          where: { key: 'super_admin_upi_vpa' },
          create: { key: 'super_admin_upi_vpa', value: body.upiVpa },
          update: { value: body.upiVpa },
        })
        const payee = body.upiPayeeName?.trim() || body.name
        await db.platformSetting.upsert({
          where: { key: 'super_admin_payee_name' },
          create: { key: 'super_admin_payee_name', value: payee },
          update: { value: payee },
        })
      }
      // Tombstone: from now on the setup page can only be re-opened through the
      // break-glass recovery — and the claim token is single-use, so consume it.
      await db.platformSetting.upsert({
        where: { key: TOMBSTONE },
        create: { key: TOMBSTONE, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      })
      if (claimValid) {
        await db.platformSetting.deleteMany({ where: { key: { in: [CLAIM_HASH, CLAIM_EXPIRES] } } })
      }
      await ensureSupabaseAuthUser(email) // enables email OTP password reset (best effort)
      await audit({ actorType: 'USER', userId: user.id, action: 'PLATFORM_SETUP_COMPLETED', entity: 'User', entityId: user.id, ip: getClientIp(req) })
      return jsonOk({ ok: true })
    }
  )
}
