// Private file storage backed by Supabase Storage (serverless-safe).
// Files live in a PRIVATE bucket, never exposed by raw URL — every consumer
// request flows through our HMAC-signed /api/files/[documentId] gate.
// Content is validated by magic bytes, never by the client-declared MIME type.
import crypto from 'crypto'
import path from 'path'
import { db } from '@/lib/db'
import { LIMITS } from '@/lib/constants'
import { signFileUrl, verifyFileSignature } from '@/lib/security'
import { storageUpload, storageDownload, storageDelete } from '@/lib/filestore'
import { HttpError } from '@/lib/auth'

// (path is used for extension parsing + path-shape validation)

function safeStoredName(original: string): string {
  // keep original extension for operator convenience; body is random
  const ext = path.extname(original).toLowerCase().slice(0, 10).replace(/[^a-z0-9.]/g, '')
  return `${crypto.randomUUID()}${ext}`
}

export interface MagicCheck {
  ok: boolean
  mime: string // detected mime
}

// Magic-byte sniffing — never trust the client's declared Content-Type.
export function detectMagic(bytes: Buffer): MagicCheck {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { ok: true, mime: 'application/pdf' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, mime: 'image/jpeg' }
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') {
    return { ok: true, mime: 'image/png' }
  }
  return { ok: false, mime: 'application/octet-stream' }
}

export async function saveUpload(shopId: string, file: File) {
  if (file.size <= 0) throw new HttpError(400, 'Empty file')
  if (file.size > LIMITS.maxUploadBytes) {
    throw new HttpError(413, `File too large (max ${Math.round(LIMITS.maxUploadBytes / 1024 / 1024)} MB)`)
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const magic = detectMagic(buf)
  if (!magic.ok) throw new HttpError(415, 'Only PDF, JPEG or PNG files are accepted')

  const storedName = safeStoredName(file.name || 'document')
  const objectPath = `uploads/${shopId}/${storedName}`
  await storageUpload(objectPath, buf, magic.mime)

  try {
    const record = await db.document.create({
      data: {
        shopId,
        originalName: (file.name || 'document').slice(0, 200),
        storedPath: objectPath,
        mimeType: magic.mime,
        sizeBytes: buf.length,
        pageCount: 0, // set by processing step
        checksum: crypto.createHash('sha256').update(buf).digest('hex'),
        status: 'READY',
      },
    })
    return { record, buffer: buf }
  } catch (err) {
    await storageDelete(objectPath) // don't orphan the object if the DB write fails
    throw err
  }
}

/**
 * Reads a stored object by its path. `storedPath` is a Supabase Storage object
 * path (e.g. `uploads/<shopId>/<uuid>.pdf`). Legacy local paths are rejected.
 */
export async function readFileAbs(storedPath: string): Promise<Buffer> {
  if (!storedPath || storedPath.includes('..') || storedPath.startsWith('/') || path.isAbsolute(storedPath)) {
    throw new HttpError(500, 'Invalid storage path')
  }
  return storageDownload(storedPath)
}

export function fileUrl(documentId: string, ttlMs = LIMITS.signedUrlTtlMs): string {
  const { exp, sig } = signFileUrl(documentId, ttlMs)
  return `/api/files/${documentId}?exp=${exp}&sig=${encodeURIComponent(sig)}`
}

export function verifyFileAccess(documentId: string, exp: string | null, sig: string | null): boolean {
  return verifyFileSignature(documentId, exp, sig)
}

// ---- Document processing: page counts (server-verified) ----

export async function processDocumentPages(docId: string): Promise<number> {
  const doc = await db.document.findUnique({ where: { id: docId } })
  if (!doc) throw new HttpError(404, 'Document not found')
  const buf = await readFileAbs(doc.storedPath)
  let pages = 0
  if (doc.mimeType === 'application/pdf') {
    const { PDFDocument } = await import('pdf-lib')
    try {
      const pdf = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })
      pages = pdf.getPageCount()
    } catch {
      throw new HttpError(422, 'File is not a readable PDF document')
    }
  } else {
    // Images: one page per image (dimensions validated for readability)
    const { imageSize } = await import('image-size')
    try {
      const dim = imageSize(buf)
      if (!dim.width || !dim.height || dim.width < 50 || dim.height < 50) throw new Error('too small')
      pages = 1
    } catch {
      throw new HttpError(422, 'Image file is not readable')
    }
  }
  if (pages < 1) throw new HttpError(422, 'Document has no pages')
  if (pages > LIMITS.maxSides) throw new HttpError(422, `Document exceeds ${LIMITS.maxSides} pages`)
  await db.document.update({ where: { id: docId }, data: { pageCount: pages } })
  return pages
}
