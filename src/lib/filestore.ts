// File storage with a backend switch:
//   STORAGE_DRIVER=database  — bytes in the app's own Postgres (StoredObject,
//                              private by design; zero extra services needed)
//   STORAGE_DRIVER=supabase  — private Supabase Storage bucket (used when the
//                              customer's Supabase project is active)
// Consumers only see upload/download/delete; raw object URLs are never exposed —
// every end-user read flows through our HMAC-signed /api/files/[documentId] gate.
import crypto from 'crypto'
import { db } from '@/lib/db'
import { supabaseConfigured } from '@/lib/supabase'

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
export const DOCUMENTS_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'csp-documents'

export const STORAGE_DRIVER = (
  process.env.STORAGE_DRIVER || (supabaseConfigured ? 'supabase' : 'database')
).toLowerCase()

// ============ Supabase Storage backend ============

let bucketReady: Promise<void> | null = null

function assertSupabaseStorage(): void {
  if (!(SUPABASE_URL && SERVICE_KEY)) throw new Error('Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
}

async function createBucketIfMissing(): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: DOCUMENTS_BUCKET,
      public: false,
      file_size_limit: 26214400, // 25 MB — matches app LIMITS.maxUploadBytes
      allowed_mime_types: ['application/pdf', 'image/jpeg', 'image/png'],
    }),
  })
  if (res.status !== 200 && res.status !== 400 && res.status !== 409) {
    throw new Error(`Supabase bucket create failed (${res.status})`)
  }
}

function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = createBucketIfMissing().catch((err) => {
      bucketReady = null
      throw err
    })
  }
  return bucketReady
}

async function sbUpload(objectPath: string, buf: Buffer, contentType: string): Promise<void> {
  assertSupabaseStorage()
  await ensureBucket()
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${DOCUMENTS_BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': contentType },
    body: buf,
  })
  if (res.status !== 200) throw new Error(`Supabase upload failed (${res.status})`)
}

async function sbDownload(objectPath: string): Promise<Buffer> {
  assertSupabaseStorage()
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${DOCUMENTS_BUCKET}/${objectPath}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (res.status !== 200) throw new Error(`Supabase download failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

async function sbDelete(objectPath: string): Promise<void> {
  try {
    assertSupabaseStorage()
    await fetch(`${SUPABASE_URL}/storage/v1/object/${DOCUMENTS_BUCKET}/${objectPath}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    })
  } catch {
    // deletion is best-effort
  }
}

// ============ Public backend API ============

export async function storageUpload(objectPath: string, buf: Buffer, contentType: string): Promise<void> {
  if (STORAGE_DRIVER === 'supabase') return sbUpload(objectPath, buf, contentType)
  await db.storedObject.upsert({
    where: { key: objectPath },
    update: { bytes: buf, mimeType: contentType, sizeBytes: buf.length },
    create: { key: objectPath, bytes: buf, mimeType: contentType, sizeBytes: buf.length },
  })
}

export async function storageDownload(objectPath: string): Promise<Buffer> {
  if (STORAGE_DRIVER === 'supabase') return sbDownload(objectPath)
  const row = await db.storedObject.findUnique({ where: { key: objectPath } })
  if (!row) throw new Error(`Stored object not found (${objectPath.split('/').pop()?.slice(0, 8)})`)
  return Buffer.from(row.bytes)
}

export async function storageDelete(objectPath: string): Promise<void> {
  if (STORAGE_DRIVER === 'supabase') return sbDelete(objectPath)
  await db.storedObject.deleteMany({ where: { key: objectPath } }).catch(() => null)
}

/** Stable content id helper (used for checksum validation paths). */
export const newObjectKey = (): string => crypto.randomUUID()
