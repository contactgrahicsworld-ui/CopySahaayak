// Printer list + management (device-registered printers). Pairing codes are
// issued under /api/admin/devices.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const printers = await db.printer.findMany({
      where: { shopId: ctx.user.shopId },
      include: { device: { select: { id: true, name: true, status: true, lastSeenAt: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const routing = await db.routingRule.findMany({ where: { shopId: ctx.user.shopId, isActive: true } })
    return jsonOk({ printers, routing })
  })
}

const patchSchema = z.object({
  id: z.string().min(5),
  displayName: z.string().trim().max(80).optional(),
  colorMode: z.enum(['BW', 'COLOR', 'ANY']).optional(),
  isDefault: z.boolean().optional(),
})

export async function PATCH(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const body = patchSchema.parse(await req.json())
    const printer = await db.printer.findFirst({ where: { id: body.id, shopId: ctx.user.shopId } })
    if (!printer) return jsonError(404, 'Printer not found')
    if (body.isDefault) {
      await db.printer.updateMany({ where: { shopId: ctx.user.shopId }, data: { isDefault: false } })
    }
    await db.printer.update({
      where: { id: printer.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.colorMode ? { colorMode: body.colorMode } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
      },
    })
    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'PRINTER_UPDATED',
      entity: 'Printer',
      entityId: printer.id,
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}

// Remove a stale/orphaned printer row from the list (e.g. left behind by a
// revoked connector or a renamed Windows printer). The connector re-registers
// it on the next heartbeat if it is still mapped in Printer Settings.
export async function DELETE(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const id = new URL(req.url).searchParams.get('id') ?? ''
    const printer = await db.printer.findFirst({ where: { id, shopId: ctx.user.shopId } })
    if (!printer) return jsonError(404, 'Printer not found')

    await db.$transaction(async (tx) => {
      // Release queued jobs that were targeted at this printer
      await tx.printJob.updateMany({
        where: { printerId: printer.id, status: { in: ['QUEUED', 'CLAIMED', 'SPOOLING'] } },
        data: { printerId: null },
      })
      await tx.printer.delete({ where: { id: printer.id } })
    })
    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'PRINTER_REMOVED',
      entity: 'Printer',
      entityId: printer.id,
      meta: { windowsName: printer.windowsName },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}
