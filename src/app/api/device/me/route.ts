// Device self-info.
import { handleRoute, jsonOk } from '@/lib/api'
import { authenticateDevice } from '@/lib/auth'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.deviceApi, bucket: 'devme' }, checkOrigin: false }, async () => {
    const device = await authenticateDevice(req)
    if (!device) return Response.json({ error: 'Device not authenticated' }, { status: 401 })
    const printers = await (await import('@/lib/db')).db.printer.findMany({ where: { deviceId: device.id } })
    return Response.json({
      device: { id: device.id, name: device.name, status: device.status },
      shop: { name: device.shop.name, slug: device.shop.slug },
      printers: printers.map((p) => ({
        id: p.id,
        windowsName: p.windowsName,
        colorMode: p.colorMode,
        paperSizes: JSON.parse(p.paperSizesJson || '[]'),
      })),
    })
  })
}
