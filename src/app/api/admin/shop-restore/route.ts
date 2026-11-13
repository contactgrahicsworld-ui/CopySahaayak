// Shop owner restore: rebuilds THIS shop's business data from their own
// backup file (chunked upload to bypass serverless body limits).
//   POST {action:'begin',  parts}               → {jobId}
//   POST {action:'part',   jobId, idx, payload} → {received: n}
//   POST {action:'commit', jobId, password}     → restore summary
// ISOLATION GUARANTEES:
//   - job is bound to ctx.user.shopId at 'begin'; part/commit re-verify.
//   - commit validates the dump's header.shopId === own shopId (a shop can
//     never restore another shop's file).
//   - restore only touches business tables — current logins (password) and
//     subscription billing are NEVER modified by a restore.
import { handleRoute, jsonOk } from '@/lib/api'
import { getAuthedUser, HttpError } from '@/lib/auth'
import { db, retryDb } from '@/lib/db'
import { audit } from '@/lib/audit'
import { getClientIp, bcryptCompare } from '@/lib/security'
import { validateDump, restoreShopDump, isGzip, MAX_BACKUP_BYTES, MAX_DECOMPRESSED_BYTES, gzipDecompressedSize } from '@/lib/backup-dump'
import zlib from 'zlib'

export const dynamic = 'force-dynamic'
const MAX_PARTS = 300

export async function POST(req: Request) {
  return handleRoute(req, { rateLimit: { max: 90, windowMs: 5 * 60_000, bucket: 'shop-restore' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')
    if (ctx.user.role !== 'SHOP_ADMIN' || !ctx.user.shopId) throw new HttpError(403, 'Sirf shop owner apna backup restore kar sakta hai')
    const body = (await req.json().catch(() => ({}))) as { action?: string; parts?: number; jobId?: string; idx?: number; payload?: string; password?: string }

    if (body.action === 'begin') {
      const parts = Number(body.parts)
      if (!Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) throw new HttpError(400, `parts 1-${MAX_PARTS} ke beech hona chahiye`)
      const job = await retryDb(() => db.backupJob.create({
        data: { kind: 'RESTORE', scope: 'SHOP', shopId: ctx.user.shopId, createdBy: ctx.user.id, state: 'UPLOADING', parts, expiresAt: new Date(Date.now() + 2 * 3600_000) },
      }))
      return jsonOk({ jobId: job.id, parts })
    }

    if (body.action === 'part') {
      const jobId = String(body.jobId || '')
      const idx = Number(body.idx)
      const payload = typeof body.payload === 'string' ? body.payload : ''
      if (!jobId || !Number.isInteger(idx) || idx < 0) throw new HttpError(400, 'jobId aur idx chahiye')
      if (payload.length > 2_200_000) throw new HttpError(413, 'Part bahut bada hai (max ~2MB per chunk)')
      const job = await retryDb(() => db.backupJob.findUnique({ where: { id: jobId } }))
      if (!job || job.kind !== 'RESTORE' || job.scope !== 'SHOP' || job.shopId !== ctx.user.shopId) throw new HttpError(404, 'Restore job not found')
      if (job.state !== 'UPLOADING') throw new HttpError(409, 'Upload band ho chuka hai')
      if (job.expiresAt < new Date()) throw new HttpError(410, 'Restore job expired — dobara shuru karein')
      if (idx >= job.parts) throw new HttpError(400, 'idx parts se bahar hai')
      await retryDb(() => db.backupChunk.upsert({
        where: { jobId_idx: { jobId, idx } },
        update: { payload },
        create: { jobId, idx, payload },
      }))
      return jsonOk({ received: idx + 1 })
    }

    if (body.action === 'commit') {
      const jobId = String(body.jobId || '')
      if (!body.password || typeof body.password !== 'string') throw new HttpError(400, 'Password confirm karna zaroori hai')
      const me = await retryDb(() => db.user.findUnique({ where: { id: ctx.user.id }, select: { passwordHash: true } }))
      if (!me || !(await bcryptCompare(body.password, me.passwordHash))) throw new HttpError(403, 'Password galat hai')
      const job = await retryDb(() => db.backupJob.findUnique({ where: { id: jobId }, include: { chunks: { orderBy: { idx: 'asc' } } } }))
      if (!job || job.kind !== 'RESTORE' || job.scope !== 'SHOP' || job.shopId !== ctx.user.shopId) throw new HttpError(404, 'Restore job not found')
      if (job.state !== 'UPLOADING') throw new HttpError(409, 'Ye restore pehle hi process ho chuka hai — dobara shuru na karein')
      if (job.chunks.length !== job.parts || job.chunks[job.chunks.length - 1]?.idx !== job.parts - 1) {
        throw new HttpError(400, `Sirf ${job.chunks.length}/${job.parts} parts mile — poora file bhejein`)
      }
      const b64 = job.chunks.map((c) => c.payload).join('')
      const raw = Buffer.from(b64, 'base64')
      if (raw.length > MAX_BACKUP_BYTES) throw new HttpError(413, 'Backup file platform ki size limit se badi hai')
      const decomp = gzipDecompressedSize(raw)
      if (decomp > MAX_DECOMPRESSED_BYTES) throw new HttpError(413, 'Backup file restore limit se badi hai — chhote hisson me purana data lein')
      let dump: unknown
      try {
        const text = isGzip(raw) ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8')
        dump = JSON.parse(text)
      } catch {
        throw new HttpError(400, 'Backup file corrupt hai (parse fail) — dobara download karein')
      }
      validateDump(dump, 'SHOP', { ownShopId: ctx.user.shopId })
      // Claim the job BEFORE the destructive delete (after all read-only checks
      // passed): a double-click / concurrent second commit can never wipe and
      // rebuild the shop's data twice (idempotency guard).
      await retryDb(() => db.backupJob.update({ where: { id: jobId }, data: { state: 'COMMITTING' } }))
      const counts = await restoreShopDump(ctx.user.shopId, dump)
      await retryDb(() => db.backupJob.delete({ where: { id: jobId } }).catch(() => null))
      await audit({
        shopId: ctx.user.shopId,
        actorType: 'USER',
        actorId: ctx.user.id,
        action: 'SHOP_RESTORED',
        entity: 'BackupJob',
        entityId: jobId,
        meta: { counts },
        ip: getClientIp(req),
      })
      return jsonOk({ restored: true, counts })
    }

    throw new HttpError(400, 'action must be: begin | part | commit')
  })
}
