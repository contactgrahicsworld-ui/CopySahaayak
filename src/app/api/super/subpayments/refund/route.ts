// Super admin marks a subscription refund as DONE (money sent back to the
// shop's UPI). POST { id, refundUtr?, refundVpa?, note? } → { ok }
// Allowed from REFUND_DUE (duplicate/unmatched gateway capture flagged by the
// money-safety engine) or VERIFIED (goodwill refund). Audited.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { z } from 'zod'
import { markSubRefunded } from '@/lib/refund'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  id: z.string().min(10).max(64),
  refundUtr: z.string().trim().regex(/^[a-zA-Z0-9]{8,22}$/).optional(),
  refundVpa: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(),
})

export async function POST(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const body = bodySchema.parse(await req.json().catch(() => ({})))
    const payment = await db.subscriptionPayment.findUnique({ where: { id: body.id } })
    if (!payment) return jsonError(404, 'Payment not found')

    const result = await markSubRefunded(body.id, ctx.user.id, { refundUtr: body.refundUtr, refundVpa: body.refundVpa, note: body.note })
    if (!result.ok) return jsonError(409, result.reason || 'Refund cannot be marked')
    await audit({
      shopId: payment.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'SUBSCRIPTION_REFUND_MARKED',
      entity: 'SubscriptionPayment',
      entityId: body.id,
      meta: { refundUtr: body.refundUtr, refundVpa: body.refundVpa },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}
