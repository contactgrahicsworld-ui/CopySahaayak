// Admin document preview: session-checked (no signed URL round trip needed).
import { db } from '@/lib/db'
import { handleRoute, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { readFileAbs } from '@/lib/storage'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'adminfile' }, checkOrigin: false }, async () => {
    const ctx = await requireAnyShopAdmin()
    const { documentId } = await params
    const doc = await db.document.findFirst({ where: { id: documentId, shopId: ctx.user.shopId } })
    if (!doc) return jsonError(404, 'File not found')
    const buf = await readFileAbs(doc.storedPath)
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': doc.mimeType,
        'Content-Length': String(buf.length),
        'Content-Disposition': `inline; filename="${doc.originalName.replace(/["\\]/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
