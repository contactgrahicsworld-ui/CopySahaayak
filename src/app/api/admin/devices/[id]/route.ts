// Revoke (or delete) a device connector — kills its token immediately.
// DELETE ?purge=1 hard-deletes REVOKED / PENDING rows so the list can be cleaned up;
// ACTIVE devices must be revoked first (purge on ACTIVE returns 400).
import { db, TX } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const { id } = await params
    const device = await db.device.findFirst({ where: { id, shopId: ctx.user.shopId } })
    if (!device) return jsonError(404, 'Device not found')

    const purge = new URL(req.url).searchParams.get('purge') === '1'
    if (purge && device.status === 'ACTIVE') {
      return jsonError(400, 'Revoke this device first, then remove it')
    }

    await db.$transaction(async (tx) => {
      // Release any jobs claimed by this device back to the queue
      await tx.printJob.updateMany({
        where: { claimedByDeviceId: device.id, status: { in: ['CLAIMED', 'SPOOLING'] } },
        data: { status: 'QUEUED', claimedByDeviceId: null, claimedAt: null, leaseUntil: null, deviceId: null },
      })
      await tx.printer.updateMany({ where: { deviceId: device.id }, data: { status: 'OFFLINE', deviceId: null } })
      if (purge) {
        // Hard-delete the row (REVOKED token is already useless; PENDING has none).
        await tx.printJob.updateMany({
          where: { claimedByDeviceId: device.id },
          data: { claimedByDeviceId: null },
        })
        await tx.device.delete({ where: { id: device.id } })
      } else {
        await tx.device.update({ where: { id: device.id }, data: { status: 'REVOKED', tokenHash: null, pairingCode: null } })
      }
    }, TX)
    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: purge ? 'DEVICE_REMOVED' : 'DEVICE_REVOKED',
      entity: 'Device',
      entityId: device.id,
      meta: { name: device.name, purged: purge || undefined },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true, purged: purge })
  })
}
