// Shop QR code — public JSON endpoint returning a PNG data-URL of the shop's
// ordering URL. Used by the admin QR card and the printable counter sign.
// Only active shops are resolvable; rate-limited like other public reads.
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { db } from '@/lib/db'
import { RATE_LIMITS } from '@/lib/rate-limit'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'shopqr' } }, async () => {
    const { slug } = await params
    const shop = await db.shop.findUnique({
      where: { slug },
      select: { name: true, isActive: true },
    })
    if (!shop || !shop.isActive) return jsonError(404, 'Shop not found')

    // Reconstruct the public origin behind proxies (Vercel / custom domains).
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
    const url = `${proto}://${host}/s/${slug}`

    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 600,
      color: { dark: '#111111', light: '#FFFFFF' },
    })
    return jsonOk({ url, dataUrl, shopName: shop.name })
  })
}
