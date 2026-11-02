// Pricing rules: read + bulk upsert (shop-specific rates per size/colour/side).
import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { pricingRuleSchema } from '@/lib/validation'
import { PAPER_SIZES, COLOR_MODES } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const rules = await db.pricingRule.findMany({ where: { shopId: ctx.user.shopId }, orderBy: [{ paperSize: 'asc' }, { colorMode: 'asc' }] })
    return jsonOk({ rules })
  })
}

const bulkSchema = z.object({ rules: z.array(pricingRuleSchema).min(1).max(8) })

export async function PUT(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const body = bulkSchema.parse(await req.json())

    for (const r of body.rules) {
      if (!PAPER_SIZES.includes(r.paperSize) || !COLOR_MODES.includes(r.colorMode)) {
        const { jsonError } = await import('@/lib/api')
        return jsonError(400, 'Invalid paper size or colour mode')
      }
      if (r.duplexPaise > r.singleSidedPaise) {
        const { jsonError } = await import('@/lib/api')
        return jsonError(400, 'Duplex price per side cannot exceed single-sided price')
      }
      await db.pricingRule.upsert({
        where: {
          shopId_paperSize_colorMode: {
            shopId: ctx.user.shopId,
            paperSize: r.paperSize,
            colorMode: r.colorMode,
          },
        },
        update: { singleSidedPaise: r.singleSidedPaise, duplexPaise: r.duplexPaise, isActive: true, updatedAt: new Date() },
        create: { shopId: ctx.user.shopId, ...r, isActive: true },
      })
    }
    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'PRICING_UPDATED',
      entity: 'PricingRule',
      meta: { count: body.rules.length },
      ip: getClientIp(req),
    })
    const rules = await db.pricingRule.findMany({ where: { shopId: ctx.user.shopId }, orderBy: [{ paperSize: 'asc' }, { colorMode: 'asc' }] })
    return jsonOk({ rules })
  })
}
