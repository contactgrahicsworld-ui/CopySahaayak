// Claim a print job. Atomic via transaction + lease; dedupes by completed state.
import { db, TX } from '@/lib/db'
import { handleRoute, jsonError } from '@/lib/api'
import { authenticateDevice } from '@/lib/auth'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { LIMITS } from '@/lib/constants'
import { fileUrl } from '@/lib/storage'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.deviceApi, bucket: 'claim' }, checkOrigin: false }, async () => {
    const device = await authenticateDevice(req)
    if (!device) return jsonError(401, 'Device not authenticated')

    const job = await db.$transaction(async (tx) => {
      // Release jobs whose claim lease expired (device crash / network loss
      // mid-print) — without this sweep a CLAIMED job would be stuck forever
      // because the query below only looks at QUEUED.
      await tx.printJob.updateMany({
        where: { shopId: device.shopId, status: 'CLAIMED', leaseUntil: { lt: new Date() } },
        data: { status: 'QUEUED', claimedByDeviceId: null, claimedAt: null, leaseUntil: null, deviceId: null },
      })
      // Prefer jobs targeted at printers of this device, then any QUEUED for the shop
      const candidates = await tx.printJob.findMany({
        where: { shopId: device.shopId, status: 'QUEUED', OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
        orderBy: { createdAt: 'asc' },
        take: 10,
        include: { printer: true },
      })
      const pick =
        candidates.find((c) => c.printer?.deviceId === device.id) ||
        candidates.find((c) => !c.printer || !c.printer.deviceId) ||
        candidates[0]
      if (!pick) return null
      return tx.printJob.update({
        where: { id: pick.id },
        data: {
          status: 'CLAIMED',
          deviceId: device.id,
          claimedByDeviceId: device.id,
          claimedAt: new Date(),
          leaseUntil: new Date(Date.now() + LIMITS.claimLeaseMs),
          attempts: { increment: 1 },
        },
        include: { orderItem: true, document: true, printer: true, order: true },
      })
    }, TX)

    if (!job) return Response.json({ job: null })
    if (job.attempts > job.maxAttempts) {
      await db.printJob.update({ where: { id: job.id }, data: { status: 'FAILED', lastError: 'Max attempts exceeded' } })
      return Response.json({ job: null })
    }

    return Response.json({
      job: {
        id: job.id,
        spoolDocumentName: job.spoolDocumentName,
        orderNumber: job.order.orderNumber,
        document: {
          id: job.document.id,
          fileName: job.document.originalName,
          mimeType: job.document.mimeType,
          downloadUrl: fileUrl(job.document.id, LIMITS.deviceDownloadTtlMs),
        },
        printSettings: {
          copies: job.orderItem.copies,
          colorMode: job.orderItem.colorMode,
          paperSize: job.orderItem.paperSize,
          duplex: job.orderItem.duplex,
          pageFrom: job.orderItem.pageFrom,
          pageTo: job.orderItem.pageTo,
        },
        printer: job.printer ? { id: job.printer.id, windowsName: job.printer.windowsName } : null,
      },
    })
  })
}
