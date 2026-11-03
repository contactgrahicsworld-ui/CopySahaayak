// Customer submits the UPI payment reference (UTR) — optionally with a
// payment screenshot. Order moves to AWAITING_VERIFICATION. Never auto-approves.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getCustomerSession, HttpError } from '@/lib/auth'
import { submitUtrSchema } from '@/lib/validation'
import { submitUtr } from '@/lib/orders'
import { saveUpload } from '@/lib/storage'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; orderNumber: string }> }) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.submitUtr, bucket: 'utr' } },
    async () => {
      const { slug, orderNumber } = await params
      const shop = await db.shop.findUnique({ where: { slug } })
      if (!shop) return jsonError(404, 'Shop not found')
      const session = await getCustomerSession(shop.id)
      if (!session) return jsonError(401, 'Session required')

      const order = await db.order.findUnique({ where: { orderNumber } })
      if (!order || order.shopId !== shop.id || order.customerSessionId !== session.id) {
        return jsonError(404, 'Order not found')
      }
      if (order.status !== 'PENDING_PAYMENT') return jsonError(409, `Order is already ${order.status.toLowerCase().replace('_', ' ')}`)

      // Accept both JSON and multipart (with optional screenshot)
      const contentType = req.headers.get('content-type') || ''
      let utr = ''
      let payerName: string | undefined
      let screenshotPath: string | undefined
      if (contentType.includes('multipart/form-data')) {
        const form = await req.formData()
        utr = String(form.get('utr') || '')
        payerName = String(form.get('payerName') || '') || undefined
        const shot = form.get('screenshot')
        if (shot instanceof File && shot.size > 0) {
          const saved = await saveUpload(shop.id, shot)
          screenshotPath = saved.record.storedPath
          // mark as screenshot (not printable)
          await db.document.update({ where: { id: saved.record.id }, data: { status: 'EXPIRED' } })
        }
      } else {
        const body = submitUtrSchema.parse(await req.json())
        utr = body.utr
        payerName = body.payerName
      }
      const parsed = submitUtrSchema.safeParse({ utr, payerName })
      if (!parsed.success) throw new HttpError(400, 'UTR must be 8-22 letters/digits')

      await submitUtr(order.id, parsed.data.utr, parsed.data.payerName, screenshotPath, getClientIp(req))
      return jsonOk({ ok: true, status: 'AWAITING_VERIFICATION' })
    }
  )
}
