import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { loginSchema } from '@/lib/validation'
import { bcryptCompare, getClientIp } from '@/lib/security'
import { createAdminSession, setSessionCookie } from '@/lib/auth'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.login, bucket: 'login' } },
    async () => {
      const body = loginSchema.parse(await req.json())
      const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
      // Constant-shape response: never reveal whether the email exists
      if (!user || !user.isActive || !(await bcryptCompare(body.password, user.passwordHash))) {
        await audit({ actorType: 'SYSTEM', action: 'LOGIN_FAILED', meta: { email: body.email } })
        return jsonError(401, 'Invalid email or password')
      }
      const token = await createAdminSession(user.id, getClientIp(req), req.headers.get('user-agent') || undefined)
      await setSessionCookie(token)
      await audit({
        shopId: user.shopId,
        userId: user.id,
        actorType: 'USER',
        action: 'LOGIN',
        ip: getClientIp(req),
      })
      return jsonOk({ user: { id: user.id, name: user.name, email: user.email, role: user.role, shopId: user.shopId } })
    }
  )
}
