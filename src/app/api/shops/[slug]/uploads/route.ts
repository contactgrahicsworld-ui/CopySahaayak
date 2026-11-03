// Customer document upload: private storage + magic-byte validation +
// server-side page counting. Returns a short-lived signed preview URL.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { getCustomerSession } from '@/lib/auth'
import { saveUpload, processDocumentPages, fileUrl } from '@/lib/storage'
import { storageDelete } from '@/lib/filestore'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/security'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.upload, bucket: 'upload' } },
    async () => {
      const { slug } = await params
      const shop = await db.shop.findUnique({ where: { slug } })
      if (!shop || !shop.isActive) return jsonError(404, 'Shop not found')
      const session = await getCustomerSession(shop.id)
      if (!session) return jsonError(401, 'Start a session first')

      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      if (!form || !(file instanceof File)) return jsonError(400, 'No file provided')

      const { record } = await saveUpload(shop.id, file)
      // Page counting AFTER persistence — rejections delete the file record
      try {
        const pages = await processDocumentPages(record.id)
        await audit({
          shopId: shop.id,
          actorType: 'CUSTOMER',
          actorId: session.id,
          action: 'DOCUMENT_UPLOADED',
          entity: 'Document',
          entityId: record.id,
          meta: { pages, mime: record.mimeType, size: record.sizeBytes },
          ip: getClientIp(req),
        })
        return jsonOk({
          documentId: record.id,
          fileName: record.originalName,
          mimeType: record.mimeType,
          sizeBytes: record.sizeBytes,
          pageCount: pages,
          previewUrl: fileUrl(record.id),
        })
      } catch (err) {
        // Validation failed — remove the stored record and the stored object
        // (storageDelete works for both the Supabase Storage and database backends;
        // never leave an orphaned object leaking storage).
        await db.document.delete({ where: { id: record.id } }).catch(() => {})
        await storageDelete(record.storedPath)
        throw err
      }
    }
  )
}
