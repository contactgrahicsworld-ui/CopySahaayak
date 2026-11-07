// Manual data backup download (admin / super admin).
//   GET /api/admin/backup?range=week|month|all          → shop admin: own shop's backup
//   GET /api/admin/backup?range=…&shopId=<id>           → super admin: one shop's backup
//   GET /api/admin/backup?range=…&platform=1            → super admin: all shops
// IDOR-safe: for SHOP_ADMIN the shopId ALWAYS comes from the session — any
// ?shopId= in the URL is ignored. Responds with a real .xlsx attachment so it
// downloads cleanly on mobile browsers as well as desktop.
import { handleRoute } from '@/lib/api'
import { getAuthedUser, HttpError } from '@/lib/auth'
import { buildBackupWorkbook, buildPlatformWorkbook, resolveBackupRange, type BackupPreset } from '@/lib/backup'
import { db, retryDb } from '@/lib/db'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { max: 12, windowMs: 60_000, bucket: 'backup' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')

    const url = new URL(req.url)
    const rangeRaw = url.searchParams.get('range') ?? 'month'
    if (rangeRaw !== 'week' && rangeRaw !== 'month' && rangeRaw !== 'all') {
      throw new HttpError(400, 'range must be one of: week, month, all')
    }
    const range = resolveBackupRange(rangeRaw as BackupPreset)

    const isSuper = ctx.user.role === 'SUPER_ADMIN'
    const shopAdminShopId = ctx.user.role === 'SHOP_ADMIN' ? ctx.user.shopId : null
    if (!isSuper && !shopAdminShopId) throw new HttpError(403, 'Access denied')

    let filename: string
    let xlsx: Buffer
    let auditedShopId: string | null = null
    let platform = false

    if (isSuper && url.searchParams.get('platform') === '1') {
      platform = true
      xlsx = await retryDb(() => buildPlatformWorkbook(range))
      filename = `CopySahaayak-Backup-Platform-${range.label}-${new Date().toISOString().slice(0, 10)}.xlsx`
    } else {
      // Super admin may target one shop; shop admins are always pinned to their own.
      const pinned = shopAdminShopId
      if (pinned) {
        const shop = await retryDb(() => db.shop.findUnique({ where: { id: pinned }, select: { slug: true } }))
        filename = `CopySahaayak-Backup-${shop?.slug || 'shop'}-${range.label}-${new Date().toISOString().slice(0, 10)}.xlsx`
        auditedShopId = pinned
        xlsx = await retryDb(() => buildBackupWorkbook(pinned, range))
      } else {
        const requested = url.searchParams.get('shopId')
        if (!requested) throw new HttpError(400, 'Super admin must pass shopId=<id> or platform=1')
        const shop = await retryDb(() => db.shop.findUnique({ where: { id: requested }, select: { id: true, slug: true, name: true } }))
        if (!shop) throw new HttpError(404, 'Shop not found')
        filename = `CopySahaayak-Backup-${shop.slug || 'shop'}-${range.label}-${new Date().toISOString().slice(0, 10)}.xlsx`
        auditedShopId = shop.id
        xlsx = await retryDb(() => buildBackupWorkbook(shop.id, range))
      }
    }

    await audit({
      shopId: auditedShopId,
      actorType: 'USER',
      actorId: ctx.user.id,
      action: 'BACKUP_DOWNLOADED',
      meta: { range: rangeRaw, platform, role: ctx.user.role },
      ip: getClientIp(req),
    })

    return new Response(new Uint8Array(xlsx), {
      status: 200,
      headers: {
        'Content-Type': XLSX,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(xlsx.length),
        'Cache-Control': 'no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
