// PLATFORM SYSTEM BACKUP — super admin only. The owner's requirement: the
// platform admin takes a FULL SYSTEM backup as a dated system file (JSON+gzip,
// all shops + all tables + uploaded files as base64) and can RESTORE the whole
// app from it. This is platform infrastructure data — NOT a shop-business
// Excel export (those live on /api/admin/backup and are shop-owner only).
//   POST   {password}                → build job {jobId, parts, filename, sizeBytes}
//   GET    ?jobId=&part=idx          → one text chunk
//   DELETE ?jobId=                   → cleanup
import { handleRoute, jsonOk } from '@/lib/api'
import { getAuthedUser, HttpError } from '@/lib/auth'
import { db, retryDb } from '@/lib/db'
import { audit } from '@/lib/audit'
import { getClientIp, bcryptCompare } from '@/lib/security'
import { buildSystemDump, chunkPayload } from '@/lib/backup-dump'
import zlib from 'zlib'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(req, { rateLimit: { max: 2, windowMs: 5 * 60_000, bucket: 'sysbk-create' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')
    if (ctx.user.role !== 'SUPER_ADMIN') throw new HttpError(403, 'Sirf Super Admin system backup le sakta hai')

    const body = (await req.json().catch(() => ({}))) as { password?: string }
    if (!body.password || typeof body.password !== 'string') throw new HttpError(400, 'Password confirm karna zaroori hai')
    const me = await retryDb(() => db.user.findUnique({ where: { id: ctx.user.id }, select: { passwordHash: true } }))
    if (!me || !(await bcryptCompare(body.password, me.passwordHash))) throw new HttpError(403, 'Password galat hai')

    const dump = await buildSystemDump()
    const json = JSON.stringify(dump)
    const gz = zlib.gzipSync(Buffer.from(json, 'utf8'), { level: 6 })
    const chunks = chunkPayload(gz.toString('base64'))
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    const filename = `CopySahaayak-System-Backup-${stamp}.json.gz`

    const expiresAt = new Date(Date.now() + 2 * 3600_000)
    const job = await retryDb(() => db.backupJob.create({
      data: { kind: 'BACKUP', scope: 'SYSTEM', createdBy: ctx.user.id, state: 'READY', parts: chunks.length, filename, sizeBytes: gz.length, expiresAt, chunks: { create: chunks.map((payload, idx) => ({ idx, payload })) } },
    }))

    await audit({
      actorType: 'USER',
      actorId: ctx.user.id,
      action: 'SYSTEM_BACKUP_CREATED',
      entity: 'BackupJob',
      entityId: job.id,
      meta: { parts: chunks.length, sizeBytes: gz.length, shops: dump.header.platformShops },
      ip: getClientIp(req),
    })

    return jsonOk({ jobId: job.id, parts: chunks.length, filename, sizeBytes: gz.length })
  })
}

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { max: 120, windowMs: 60_000, bucket: 'sysbk-part' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')
    if (ctx.user.role !== 'SUPER_ADMIN') throw new HttpError(403, 'Access denied')
    const url = new URL(req.url)
    const jobId = url.searchParams.get('jobId') || ''
    const idx = Number(url.searchParams.get('part'))
    if (!jobId || !Number.isInteger(idx) || idx < 0) throw new HttpError(400, 'jobId aur part chahiye')
    const job = await retryDb(() => db.backupJob.findUnique({ where: { id: jobId } }))
    if (!job || job.kind !== 'BACKUP' || job.scope !== 'SYSTEM') throw new HttpError(404, 'Backup job not found')
    if (job.expiresAt < new Date()) throw new HttpError(410, 'Backup expired — dobara banayein')
    const chunk = await retryDb(() => db.backupChunk.findUnique({ where: { jobId_idx: { jobId, idx } } }))
    if (!chunk) throw new HttpError(404, `Chunk ${idx} missing`)
    return jsonOk({ idx, payload: chunk.payload })
  })
}

export async function DELETE(req: Request) {
  return handleRoute(req, { rateLimit: { max: 30, windowMs: 60_000, bucket: 'sysbk-del' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')
    if (ctx.user.role !== 'SUPER_ADMIN') throw new HttpError(403, 'Access denied')
    const url = new URL(req.url)
    const jobId = url.searchParams.get('jobId') || ''
    const job = await retryDb(() => db.backupJob.findUnique({ where: { id: jobId } }))
    if (!job || job.scope !== 'SYSTEM') throw new HttpError(404, 'Backup job not found')
    await retryDb(() => db.backupJob.delete({ where: { id: jobId } }))
    return jsonOk({ deleted: true })
  })
}
