// Plans: list + update (Super Admin).
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { planSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const plans = await db.plan.findMany({ orderBy: { sortOrder: 'asc' } })
    return jsonOk({ plans: plans.map((p) => ({ ...p, features: JSON.parse(p.featuresJson || '[]') })) })
  })
}

export async function PATCH(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return jsonError(400, 'Plan id required (?id=)')
    const body = planSchema.parse(await req.json())
    const plan = await db.plan.update({
      where: { id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.pricePaise !== undefined ? { pricePaise: body.pricePaise } : {}),
        ...(body.durationDays !== undefined ? { durationDays: body.durationDays } : {}),
        ...(body.maxOrdersMonth !== undefined ? { maxOrdersMonth: body.maxOrdersMonth } : {}),
        ...(body.maxDevices !== undefined ? { maxDevices: body.maxDevices } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    })
    return jsonOk({ plan: { ...plan, features: JSON.parse(plan.featuresJson || '[]') } })
  })
}
