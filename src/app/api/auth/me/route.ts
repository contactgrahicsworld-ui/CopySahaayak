import { handleRoute, jsonOk } from '@/lib/api'
import { getAuthedUser } from '@/lib/auth'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, { checkOrigin: false }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) return jsonOk({ user: null })
    let shopName: string | null = null
    let shopSlug: string | null = null
    if (ctx.user.shopId) {
      const shop = await db.shop.findUnique({ where: { id: ctx.user.shopId } })
      shopName = shop?.name || null
      shopSlug = shop?.slug || null
    }
    return jsonOk({ user: { ...ctx.user, shopName, shopSlug } })
  })
}
