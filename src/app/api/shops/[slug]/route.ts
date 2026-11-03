// Public shop info + pricing for the customer ordering page.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'shop' }, checkOrigin: false }, async () => {
    const { slug } = await params
    const shop = await db.shop.findUnique({
      where: { slug },
      include: {
        pricingRules: { where: { isActive: true } },
        subscription: { include: { plan: true } },
      },
    })
    if (!shop || !shop.isActive) return jsonError(404, 'Shop not found')
    const subOk =
      shop.subscription &&
      ['ACTIVE', 'PENDING_VERIFICATION'].includes(shop.subscription.status) &&
      (!shop.subscription.expiresAt || shop.subscription.expiresAt > new Date())
    if (!subOk) return jsonError(404, 'Shop is not accepting orders currently')
    return jsonOk({
      shop: {
        name: shop.name,
        slug: shop.slug,
        ownerName: shop.ownerName,
        phone: shop.phone,
        address: shop.address,
        hasLogo: !!shop.logoPath,
        upiConfigured: !!shop.upiVpa,
      },
      pricing: shop.pricingRules.map((r) => ({
        paperSize: r.paperSize,
        colorMode: r.colorMode,
        singleSidedPaise: r.singleSidedPaise,
        duplexPaise: r.duplexPaise,
      })),
    })
  })
}
