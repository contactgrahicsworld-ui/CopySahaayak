// Order actions for the shop: cancel, mark completed, reprint (requeue jobs),
// and print-job visibility. All scoped to the admin's own shop.
import { db, TX } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin, HttpError } from '@/lib/auth'
import { enqueuePrintJobs } from '@/lib/orders'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

const actionSchema = z.object({
  action: z.enum(['CANCEL', 'COMPLETE', 'REQUEUE_JOBS']),
  note: z.string().trim().max(300).optional(),
})

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const { id } = await params
    const order = await db.order.findFirst({
      where: { id, shopId },
      include: {
        items: { include: { document: { select: { originalName: true, pageCount: true, id: true } }, printJobs: true } },
        payment: true,
        customerSession: { select: { name: true, phone: true } },
      },
    })
    if (!order) return jsonError(404, 'Order not found')
    return jsonOk({ order })
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const { id } = await params
    const body = actionSchema.parse(await req.json())

    const order = await db.order.findFirst({ where: { id, shopId } })
    if (!order) return jsonError(404, 'Order not found')

    switch (body.action) {
      case 'CANCEL': {
        if (['COMPLETED', 'CANCELLED'].includes(order.status)) throw new HttpError(409, `Order already ${order.status}`)
        await db.$transaction(async (tx) => {
          await tx.order.update({ where: { id }, data: { status: 'CANCELLED' } })
          await tx.printJob.updateMany({ where: { orderId: id, status: { in: ['QUEUED', 'CLAIMED'] } }, data: { status: 'CANCELLED' } })
        }, TX)
        break
      }
      case 'COMPLETE': {
        if (order.status !== 'CONFIRMED') throw new HttpError(409, 'Only confirmed orders can be marked complete')
        await db.$transaction(async (tx) => {
          await tx.order.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date() } })
          await tx.printJob.updateMany({ where: { orderId: id, status: { in: ['QUEUED', 'CLAIMED', 'SPOOLING'] } }, data: { status: 'CANCELLED' } })
        }, TX)
        break
      }
      case 'REQUEUE_JOBS': {
        // Reset failed print jobs back to QUEUED (manual retry)
        const result = await db.printJob.updateMany({
          where: { orderId: id, shopId, status: 'FAILED' },
          data: { status: 'QUEUED', attempts: 0, lastError: null, deviceId: null, claimedByDeviceId: null, claimedAt: null },
        })
        if (result.count === 0) {
          // Also allows initial re-fanout if verification happened while no printer was online
          await enqueuePrintJobs(id)
        }
        if (order.status === 'CONFIRMED' || order.status === 'COMPLETED') {
          await db.order.update({ where: { id }, data: { status: 'CONFIRMED', completedAt: null } })
        }
        break
      }
    }
    await audit({
      shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: `ORDER_${body.action}`,
      entity: 'Order',
      entityId: id,
      meta: { note: body.note },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}
