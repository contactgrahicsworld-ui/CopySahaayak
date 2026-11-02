import { handleRoute, jsonOk } from '@/lib/api'
import { clearSessionCookie, destroyAdminSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(req, {}, async () => {
    await destroyAdminSession()
    await clearSessionCookie()
    return jsonOk({ ok: true })
  })
}
