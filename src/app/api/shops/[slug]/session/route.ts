// Guest customer session — no registration required.
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getOrCreateCustomerSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/security'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  name: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(15).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'csess' } }, async () => {
    const { slug } = await params
    const shop = await db.shop.findUnique({ where: { slug } })
    if (!shop || !shop.isActive) return jsonError(404, 'Shop not found')
    const body = bodySchema.safeParse(await req.json().catch(() => ({})))
    const { name, phone } = body.success ? body.data : { name: undefined, phone: undefined }
    const session = await getOrCreateCustomerSession(
      shop.id,
      name,
      phone,
      getClientIp(req),
      req.headers.get('user-agent') || undefined
    )
    return jsonOk({ sessionId: session.id, shopName: shop.name })
  })
}
