// Platform audit log viewer (Super Admin).
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireSuper, HttpError } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const shopId = url.searchParams.get('shopId')
    const takeRaw = Number(url.searchParams.get('take') ?? '100')
    if (!Number.isFinite(takeRaw) || takeRaw < 1) throw new HttpError(400, 'take must be a positive number')
    const take = Math.min(Math.floor(takeRaw), 300)
    const logs = await db.auditLog.findMany({
      where: {
        ...(action ? { action: { contains: action.toUpperCase() } } : {}),
        ...(shopId ? { shopId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { user: { select: { email: true, name: true } }, shop: { select: { name: true, slug: true } } },
    })
    return jsonOk({ logs })
  })
}
