// Routing rules: which printer handles which colour/size. Simple list API.
import { db, TX } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { routingRuleSchema } from '@/lib/validation'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const putSchema = z.object({ rules: z.array(routingRuleSchema).max(20) })

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const rules = await db.routingRule.findMany({
      where: { shopId: ctx.user.shopId },
      include: { printer: { select: { id: true, windowsName: true, displayName: true, colorMode: true } } },
      orderBy: { priority: 'desc' },
    })
    return jsonOk({ rules })
  })
}

export async function PUT(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const body = putSchema.parse(await req.json())

    // Validate printers belong to this shop (IDOR)
    for (const r of body.rules) {
      const p = await db.printer.findFirst({ where: { id: r.printerId, shopId: ctx.user.shopId } })
      if (!p) return jsonError(400, 'Printer does not belong to your shop')
    }

    await db.$transaction(async (tx) => {
      await tx.routingRule.deleteMany({ where: { shopId: ctx.user.shopId } })
      let priority = body.rules.length
      for (const r of body.rules) {
        await tx.routingRule.create({
          data: {
            shopId: ctx.user.shopId,
            colorMode: r.colorMode,
            paperSize: r.paperSize || null,
            printerId: r.printerId,
            priority: priority--,
            isActive: true,
          },
        })
      }
    }, TX)
    const rules = await db.routingRule.findMany({
      where: { shopId: ctx.user.shopId },
      include: { printer: { select: { id: true, windowsName: true, displayName: true, colorMode: true } } },
      orderBy: { priority: 'desc' },
    })
    return jsonOk({ rules })
  })
}
