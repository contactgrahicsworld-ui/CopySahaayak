// Shop owner's own business backup — SYSTEM FILE with date (chunked JSON+gzip).
//   POST /api/admin/shop-backup  {password}          → build backup job (parts list)
//   GET  /api/admin/shop-backup?jobId=&part=idx      → fetch one text chunk
//   DELETE /api/admin/shop-backup?jobId=             → cleanup after download
// TENANT ISOLATION: pinned to ctx.user.shopId always. A shop owner can never
// create a backup of another shop, and the dump never contains platform
// tables (users/sessions/subscription billing) — logins and billing belong to
// the platform. Excel export of the SAME own-shop data stays on
// /api/admin/backup (range-based). Password-confirmed + audit-logged.
import { handleRoute, jsonOk } from '@/lib/api'
import { getAuthedUser, HttpError } from '@/lib/auth'
import { db, retryDb } from '@/lib/db'
import { audit } from '@/lib/audit'
import { getClientIp, bcryptCompare } from '@/lib/security'
import { buildShopDump, chunkPayload } from '@/lib/backup-dump'
import zlib from 'zlib'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(req, { rateLimit: { max: 3, windowMs: 5 * 60_000, bucket: 'shopbk-create' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')
    if (ctx.user.role !== 'SHOP_ADMIN' || !ctx.user.shopId) throw new HttpError(403, 'Sirf shop owner apna business backup le sakta hai')

    const body = (await req.json().catch(() => ({}))) as { password?: string }
    if (!body.password || typeof body.password !== 'string') throw new HttpError(400, 'Password confirm karna zaroori hai')
    const me = await retryDb(() => db.user.findUnique({ where: { id: ctx.user.id }, select: { passwordHash: true } }))
    if (!me || !(await bcryptCompare(body.password, me.passwordHash))) throw new HttpError(403, 'Password galat hai')

    const dump = await buildShopDump(ctx.user.shopId)
    const json = JSON.stringify(dump)
    const gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 6 })
    const chunks = chunkPayload(gz.toString('base64'))
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    const filename = `CopySahaayak-Business-Backup-${dump.header.shopSlug || 'shop'}-${stamp}.json.gz`

    const expiresAt = new Date(Date.now() + 2 * 3600_000)
    const job = await retryDb(() => db.backupJob.create({
      data: { kind: 'BACKUP', scope: 'SHOP', shopId: ctx.user.shopId, createdBy: ctx.user.id, state: 'READY', parts: chunks.length, filename, sizeBytes: gz.length, expiresAt, chunks: { create: chunks.map((payload, idx) => ({ idx, payload })) } },
    }))

    await audit({
      shopId: ctx.user.shopId,
      actorType: 'USER',
      actorId: ctx.user.id,
      action: 'SHOP_BACKUP_CREATED',
      entity: 'BackupJob',
      entityId: job.id,
      meta: { parts: chunks.length, sizeBytes: gz.length },
      ip: getClientIp(req),
    })

    return jsonOk({ jobId: job.id, parts: chunks.length, filename, sizeBytes: gz.length })
  })
}

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { max: 120, windowMs: 60_000, bucket: 'shopbk-part' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')
    if (ctx.user.role !== 'SHOP_ADMIN' || !ctx.user.shopId) throw new HttpError(403, 'Access denied')
    const url = new URL(req.url)
    const jobId = url.searchParams.get('jobId') || ''
    const idx = Number(url.searchParams.get('part'))
    if (!jobId || !Number.isInteger(idx) || idx < 0) throw new HttpError(400, 'jobId aur part chahiye')
    const job = await retryDb(() => db.backupJob.findUnique({ where: { id: jobId } }))
    if (!job || job.kind !== 'BACKUP' || job.scope !== 'SHOP' || job.shopId !== ctx.user.shopId) throw new HttpError(404, 'Backup job not found')
    if (job.expiresAt < new Date()) throw new HttpError(410, 'Backup expired — dobara banayein')
    const chunk = await retryDb(() => db.backupChunk.findUnique({ where: { jobId_idx: { jobId, idx } } }))
    if (!chunk) throw new HttpError(404, `Chunk ${idx} missing`)
    return jsonOk({ idx, payload: chunk.payload })
  })
}

export async function DELETE(req: Request) {
  return handleRoute(req, { rateLimit: { max: 30, windowMs: 60_000, bucket: 'shopbk-del' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')
    if (ctx.user.role !== 'SHOP_ADMIN' || !ctx.user.shopId) throw new HttpError(403, 'Access denied')
    const url = new URL(req.url)
    const jobId = url.searchParams.get('jobId') || ''
    const job = await retryDb(() => db.backupJob.findUnique({ where: { id: jobId } }))
    if (!job || job.kind !== 'BACKUP' || job.scope !== 'SHOP' || job.shopId !== ctx.user.shopId) throw new HttpError(404, 'Backup job not found')
    await retryDb(() => db.backupJob.delete({ where: { id: jobId } }))
    return jsonOk({ deleted: true })
  })
}
