// One-time platform setup: creates the FIRST Super Admin.
// Blocked forever once one exists — no predefined credentials ship with the app.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { setupSchema } from '@/lib/validation'
import { bcryptHash, getClientIp } from '@/lib/security'
import { ensurePlatformBootstrap } from '@/lib/bootstrap'
import { ensureSupabaseAuthUser } from '@/lib/supabase'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'setup' } }, async () => {
    const supers = await db.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })
    return jsonOk({ setupDone: supers > 0 })
  })
}

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.pairing, bucket: 'setup' } },
    async () => {
      const existing = await db.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })
      if (existing > 0) return jsonError(403, 'Setup is already completed. Please sign in instead.')

      const body = setupSchema.parse(await req.json())
      const email = body.email.toLowerCase()

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
      await ensureSupabaseAuthUser(email) // enables email OTP password reset (best effort)
      await audit({ actorType: 'USER', userId: user.id, action: 'PLATFORM_SETUP_COMPLETED', entity: 'User', entityId: user.id, ip: getClientIp(req) })
      return jsonOk({ ok: true })
    }
  )
}
