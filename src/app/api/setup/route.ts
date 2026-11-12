// One-time platform setup: creates the FIRST Super Admin.
// No predefined credentials ship with the app and no script fills them — the
// platform owner types their own email + password on the creation page.
//
// Two unlock paths, both ending in the same single creation:
//   • Simple one-shot (owner request: keep the page SIMPLE): the form carries
//     the recovery key (SUPER_SETUP_RESET_KEY) and the server verifies it and
//     does reset+create atomically in one transaction.
//   • Legacy two-step: POST /api/setup/reset issues a one-time 15-minute claim
//     token; creation then consumes exactly that token.
// First run (a platform has never had a super admin): no key/token needed.
// Ever after (tombstone `super_setup_used` exists): setup is locked — recovery
// key or claim token required, and the page is never publicly re-openable.
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
      const body = setupSchema.parse(await req.json())
      const email = body.email.toLowerCase()

      const activeSupers = await db.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })
      const used = await platformSetting(TOMBSTONE)

      // Decide how this creation is authorised.
      let viaResetKey = false
      let claimValid = false
      if (activeSupers > 0) {
        // Platform locked: only the break-glass key unlocks a one-shot
        // reset+create. Anything else is refused.
        if (!body.resetKey) {
          return jsonError(403, 'Setup is already completed. Please sign in instead.')
        }
        viaResetKey = true
      } else if (used) {
        // recoveryRequired: no active super, platform had one before.
        if (body.resetKey) {
          viaResetKey = true
        } else if (body.claimToken) {
          const storedHash = await platformSetting(CLAIM_HASH)
          const expiresAt = await platformSetting(CLAIM_EXPIRES)
          claimValid = Boolean(
            storedHash &&
            expiresAt &&
            timingSafeEqualStr(storedHash, sha256(body.claimToken)) &&
            new Date(expiresAt) > new Date()
          )
          if (!claimValid) return jsonError(403, 'Recovery claim is invalid or expired. Run the recovery again.')
        } else {
          return jsonError(403, 'Recovery key required. Enter your recovery key on this page to unlock setup.')
        }
      }

      if (viaResetKey) {
        const envKey = process.env.SUPER_SETUP_RESET_KEY || ''
        if (!envKey) return jsonError(403, 'Recovery is not configured on this deployment.')
        if (!timingSafeEqualStr(envKey, body.resetKey!)) {
          await audit({ actorType: 'SYSTEM', action: 'SUPER_SETUP_RESET_DENIED', ip: getClientIp(req) })
          return jsonError(401, 'Invalid recovery key')
        }
      }

      const dupe = await db.user.findUnique({ where: { email } })
      if (dupe) return jsonError(409, 'This email is already registered. Please sign in.')

      await ensurePlatformBootstrap()
      // Hash BEFORE opening the transaction — bcrypt must not hold the DB connection.
      const passwordHash = await bcryptHash(body.password)
      // Full form sends name + WhatsApp; fallback derive stays as defense-in-depth.
      const derived = email.split('@')[0]?.replace(/[._\-]+/g, ' ').trim() || ''
      const name = (body.name?.trim() || derived || 'Platform Owner').slice(0, 80)

      const user = await db.$transaction(async (tx) => {
        if (viaResetKey) {
          // Atomic break-glass: old super credentials (and their sessions)
          // disappear in the same transaction that creates the new account.
          await tx.user.deleteMany({ where: { role: 'SUPER_ADMIN' } })
          // Stale payment destination removed — the fresh admin sets a new UPI.
          await tx.platformSetting.upsert({ where: { key: 'super_admin_upi_vpa' }, update: { value: '' }, create: { key: 'super_admin_upi_vpa', value: '' } })
          await tx.platformSetting.upsert({ where: { key: 'super_admin_payee_name' }, update: { value: 'CopySahaayak Platforms' }, create: { key: 'super_admin_payee_name', value: 'CopySahaayak Platforms' } })
          // Pending platform transfers die with their authority.
          await tx.authorityTransfer.updateMany({ where: { scope: 'PLATFORM', status: 'PENDING' }, data: { status: 'CANCELLED' } })
        }
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            name,
            phone: body.phone || null,
            role: 'SUPER_ADMIN',
            shopId: null,
          },
        })
        // Persist the platform UPI where all shop-owner plan payments will be
        // collected (optional on the simple page; editable later in Settings).
        if (body.upiVpa) {
          await tx.platformSetting.upsert({
            where: { key: 'super_admin_upi_vpa' },
            create: { key: 'super_admin_upi_vpa', value: body.upiVpa },
            update: { value: body.upiVpa },
          })
          const payee = body.upiPayeeName?.trim() || name
          await tx.platformSetting.upsert({
            where: { key: 'super_admin_payee_name' },
            create: { key: 'super_admin_payee_name', value: payee },
            update: { value: payee },
          })
        }
        // Tombstone: from now on the setup page can only be re-opened through
        // the break-glass recovery. Consume any outstanding claim token.
        await tx.platformSetting.upsert({
          where: { key: TOMBSTONE },
          create: { key: TOMBSTONE, value: new Date().toISOString() },
          update: { value: new Date().toISOString() },
        })
        await tx.platformSetting.deleteMany({ where: { key: { in: [CLAIM_HASH, CLAIM_EXPIRES] } } })
        return created
      })

      await ensureSupabaseAuthUser(email) // enables email OTP password reset (best effort)
      await audit({
        actorType: 'USER',
        userId: user.id,
        action: viaResetKey ? 'SUPER_SETUP_RESET' : 'PLATFORM_SETUP_COMPLETED',
        entity: 'User',
        entityId: user.id,
        meta: viaResetKey ? { mode: 'self-create-one-shot' } : undefined,
        ip: getClientIp(req),
      })
      return jsonOk({ ok: true })
    }
  )
}
