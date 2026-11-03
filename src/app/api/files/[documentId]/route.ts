// Streams a private document via short-lived HMAC-signed URL.
// No session required — the signature IS the capability (10-minute TTL).
import { db } from '@/lib/db'
import { handleRoute, jsonError } from '@/lib/api'
import { readFileAbs, verifyFileAccess } from '@/lib/storage'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'files' }, checkOrigin: false }, async () => {
    const { documentId } = await params
    const url = new URL(req.url)
    if (!verifyFileAccess(documentId, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
      return jsonError(403, 'Link expired or invalid')
    }
    const doc = await db.document.findUnique({ where: { id: documentId } })
    if (!doc || doc.status === 'REJECTED') return jsonError(404, 'File not found')
    const buf = await readFileAbs(doc.storedPath)
    const inline = url.searchParams.get('dl') !== '1'
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': doc.mimeType,
        'Content-Length': String(buf.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${doc.originalName.replace(/["\\]/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
