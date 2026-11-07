// Device heartbeat: pushes its printer inventory (server upserts) and reports
// liveness. Returns device status so a revoked device stops working instantly.
import { db, TX } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { authenticateDevice } from '@/lib/auth'
import { heartbeatSchema } from '@/lib/validation'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.deviceApi, bucket: 'hb' }, checkOrigin: false }, async () => {
    const device = await authenticateDevice(req)
    if (!device) return Response.json({ error: 'Device not authenticated' }, { status: 401 })

    const body = heartbeatSchema.parse(await req.json())

    await db.$transaction(async (tx) => {
      await tx.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), ...(body.appVersion ? { appVersion: body.appVersion } : {}) } })
      const claimedIds: string[] = []
      for (const p of body.printers) {
        const existing = await tx.printer.findUnique({
          where: { shopId_windowsName: { shopId: device.shopId, windowsName: p.windowsName } },
        })
        if (existing) {
          // Only update if this device owns it (or it was orphaned)
          if (!existing.deviceId || existing.deviceId === device.id) {
            await tx.printer.update({
              where: { id: existing.id },
              data: {
                deviceId: device.id, colorMode: p.colorMode, paperSizesJson: JSON.stringify(p.paperSizes),
                status: 'ONLINE', lastSeenAt: new Date(),
                healthStatus: p.healthStatus ?? 'OK',
                healthDetail: p.healthDetail ?? null,
              },
            })
            claimedIds.push(existing.id)
          }
        } else {
          const created = await tx.printer.create({
            data: {
              shopId: device.shopId,
              deviceId: device.id,
              windowsName: p.windowsName,
              colorMode: p.colorMode,
              paperSizesJson: JSON.stringify(p.paperSizes),
              status: 'ONLINE',
              lastSeenAt: new Date(),
              isDefault: false,
              healthStatus: p.healthStatus ?? 'OK',
              healthDetail: p.healthDetail ?? null,
            },
          })
          claimedIds.push(created.id)
        }
      }
      // Printers registered to this device but absent from the heartbeat went offline
      const mine = await tx.printer.findMany({ where: { deviceId: device.id } })
      const reported = new Set(body.printers.map((p) => p.windowsName))
      for (const m of mine) {
        if (!reported.has(m.windowsName)) {
          await tx.printer.update({ where: { id: m.id }, data: { status: 'OFFLINE' } })
        }
      }
    }, TX)

    const pending = await db.printJob.count({ where: { shopId: device.shopId, status: 'QUEUED' } })
    return Response.json({ ok: true, deviceStatus: device.status, pendingJobs: pending })
  })
}
