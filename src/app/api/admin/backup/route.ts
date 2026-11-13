// Shop owner's own Excel backup download (range-based).
// TENANT ISOLATION (owner requirement): ONLY the SHOP_ADMIN can download an
// Excel backup, and it is ALWAYS their own shop — the super admin has NO
// access to shop business data (that was removed; the platform admin instead
// takes whole-SYSTEM backups via /api/super/system-backup). The shopId ALWAYS
// comes from the session — any ?shopId= in the URL is ignored. Responds with a
// real .xlsx attachment so it downloads cleanly on mobile browsers as well.
import { handleRoute } from '@/lib/api'
import { getAuthedUser, HttpError } from '@/lib/auth'
import { buildBackupWorkbook, resolveBackupRange, type BackupPreset } from '@/lib/backup'
import { db, retryDb } from '@/lib/db'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { max: 12, windowMs: 60_000, bucket: 'backup' } }, async () => {
    const ctx = await getAuthedUser()
    if (!ctx) throw new HttpError(401, 'Authentication required')
    if (ctx.user.role === 'SUPER_ADMIN') {
      // Isolation: platform admin must not export any shop's business data.
      throw new HttpError(403, 'Super Admin shop ka business data export nahi kar sakta (tenant isolation) — system backup use karein')
    }
    const shopAdminShopId = ctx.user.role === 'SHOP_ADMIN' ? ctx.user.shopId : null
    if (!shopAdminShopId) throw new HttpError(403, 'Access denied')

    const url = new URL(req.url)
    const rangeRaw = url.searchParams.get('range') ?? 'month'
    if (rangeRaw !== 'week' && rangeRaw !== 'month' && rangeRaw !== 'all') {
      throw new HttpError(400, 'range must be one of: week, month, all')
    }
    const range = resolveBackupRange(rangeRaw as BackupPreset)

    const shop = await retryDb(() => db.shop.findUnique({ where: { id: shopAdminShopId }, select: { slug: true } }))
    const filename = `CopySahaayak-Backup-${shop?.slug || 'shop'}-${range.label}-${new Date().toISOString().slice(0, 10)}.xlsx`
    const xlsx = await retryDb(() => buildBackupWorkbook(shopAdminShopId, range))

    await audit({
      shopId: shopAdminShopId,
      actorType: 'USER',
      actorId: ctx.user.id,
      action: 'BACKUP_DOWNLOADED',
      meta: { range: rangeRaw, role: ctx.user.role },
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
