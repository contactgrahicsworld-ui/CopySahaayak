// Print job lifecycle events from the connector.
// SPOOLING → job physically handed to the Windows spooler.
// COMPLETED → spooler confirmed the job finished. Enforced: only the device
// holding the claim may report COMPLETED, and never from a QUEUED/never-claimed
// job (no fake "printed" states). CLAIMED is accepted so a lost SPOOLING event
// cannot make a job permanently un-completable.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { authenticateDevice } from '@/lib/auth'
import { printEventSchema } from '@/lib/validation'
import { recordPrintEvent } from '@/lib/orders'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.deviceApi, bucket: 'jobev' }, checkOrigin: false }, async () => {
    const device = await authenticateDevice(req)
    if (!device) return jsonError(401, 'Device not authenticated')
    const { id } = await params
    const body = printEventSchema.parse(await req.json())

    try {
      await recordPrintEvent(id, body.status, device.id, body.message)
    } catch (err) {
      if (err instanceof Error && 'status' in err) throw err
      throw err
    }
    await audit({
      shopId: device.shopId,
      actorType: 'DEVICE',
      actorId: device.id,
      action: `PRINT_${body.status}`,
      entity: 'PrintJob',
      entityId: id,
      meta: { message: body.message },
      ip: getClientIp(req),
    })
    return jsonOk({ ok: true })
  })
}
