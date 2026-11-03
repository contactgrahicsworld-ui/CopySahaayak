// Verify or reject a customer's UPI payment. VERIFY fans out print jobs.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { verifyPayment } from '@/lib/orders'
import { verifyPaymentActionSchema } from '@/lib/validation'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const shopId = ctx.user.shopId
    const { id } = await params
    const body = verifyPaymentActionSchema.parse(await req.json())

    // Tenant check before acting
    const payment = await db.payment.findFirst({ where: { id, shopId } })
    if (!payment) return jsonError(404, 'Payment not found')

    await verifyPayment(id, body.action, { id: ctx.user.id }, body.note, getClientIp(req))
    return jsonOk({ ok: true, action: body.action })
  })
}
