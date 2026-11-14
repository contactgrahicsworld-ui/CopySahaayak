// Shop admin marks a customer refund as DONE (money sent back via UPI).
//   POST { refundUtr?, refundVpa?, note? } → { ok }
// Allowed from REFUND_DUE (flagged by the money-safety engine) or VERIFIED
// (shop voluntarily refunds without cancelling). Audited; the customer's
// tracker switches to REFUNDED automatically on next poll.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { z } from 'zod'
import { markOrderRefunded } from '@/lib/refund'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  refundUtr: z.string().trim().regex(/^[a-zA-Z0-9]{8,22}$/).optional(),
  refundVpa: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const { id } = await params
    const body = bodySchema.parse(await req.json().catch(() => ({})))

    const payment = await db.payment.findFirst({ where: { id, shopId } })
    if (!payment) return jsonError(404, 'Payment not found')

    const result = await markOrderRefunded(id, ctx.user.id, body)
    if (!result.ok) return jsonError(409, result.reason || 'Refund cannot be marked')
    await audit({
      shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'PAYMENT_REFUND_MARKED',
      entity: 'Payment',
      entityId: id,
      meta: { refundUtr: body.refundUtr, refundVpa: body.refundVpa },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}
