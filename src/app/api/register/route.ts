// Shop self-registration: creates the shop (ACTIVE, Free plan) + its owner
// account. No super-admin approval needed to start; the super admin can
// suspend shops from the platform dashboard. Credentials are never predefined.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { registerSchema } from '@/lib/validation'
import { bcryptHash, getClientIp, randomToken, sha256 } from '@/lib/security'
import { createAdminSession, setSessionCookie } from '@/lib/auth'
import { ensurePlatformBootstrap, defaultPricingRules } from '@/lib/bootstrap'
import { ensureSupabaseAuthUser } from '@/lib/supabase'
import { LIMITS } from '@/lib/constants'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.register, bucket: 'register' } },
    async () => {
      const body = registerSchema.parse(await req.json())
      const email = body.email.toLowerCase()
      const slug = body.slug.toLowerCase()

      const [slugTaken, emailTaken] = await Promise.all([
        db.shop.findUnique({ where: { slug } }),
        db.user.findUnique({ where: { email } }),
      ])
      if (slugTaken) return jsonError(409, 'That shop URL is already taken. Try another name.')
      if (emailTaken) return jsonError(409, 'This email is already registered. Please sign in.')

      await ensurePlatformBootstrap()
      const freePlan = await db.plan.findUnique({ where: { code: 'FREE' } })
      if (!freePlan) return jsonError(500, 'Plans are not provisioned yet')

      const now = new Date()
      const user = await db.$transaction(async (tx) => {
        const shop = await tx.shop.create({
          data: {
            slug,
            name: body.shopName,
            ownerName: body.ownerName,
            phone: body.shopPhone || null,
            address: body.shopAddress || null,
            upiVpa: body.upiVpa || null,
            upiPayeeName: body.upiPayeeName || body.shopName,
            isActive: true,
            pricingRules: { create: defaultPricingRules() },
            subscription: {
              create: { planId: freePlan.id, status: 'ACTIVE', startsAt: now, expiresAt: new Date(now.getTime() + freePlan.durationDays * 86400_000) },
            },
          },
        })
        return tx.user.create({
          data: {
            email,
            passwordHash: await bcryptHash(body.password),
            name: body.ownerName,
            phone: body.shopPhone || null,
            role: 'SHOP_ADMIN',
            shopId: shop.id,
            memberships: { create: { shopId: shop.id, role: 'OWNER' } },
          },
        })
      })

      await ensureSupabaseAuthUser(email) // enables email OTP password reset (best effort)
      await audit({ shopId: user.shopId, actorType: 'USER', userId: user.id, action: 'SHOP_REGISTERED', entity: 'Shop', entityId: user.shopId, ip: getClientIp(req) })

      // Auto sign-in so the owner lands straight in their dashboard
      const token = await createAdminSession(user.id, getClientIp(req), req.headers.get('user-agent') || undefined)
      await setSessionCookie(token)
      return jsonOk({ user: { id: user.id, name: user.name, email: user.email, role: user.role, shopId: user.shopId }, shopSlug: slug })
    }
  )
}
