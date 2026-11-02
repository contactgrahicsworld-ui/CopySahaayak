// Device pairing: exchange pairing code for a device token.
// Rate-limited; code is single-use, expires in 15 min; shop must be active.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { devicePairSchema } from '@/lib/validation'
import { randomToken, sha256, getClientIp } from '@/lib/security'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.pairing, bucket: 'pair' }, checkOrigin: false },
    async () => {
      const body = devicePairSchema.parse(await req.json())
      const device = await db.device.findFirst({ where: { pairingCode: body.pairingCode } })
      if (!device || !device.pairingExpiresAt || device.pairingExpiresAt < new Date() || device.status !== 'PENDING') {
        return jsonError(401, 'Invalid or expired pairing code')
      }
      const shop = await db.shop.findUnique({ where: { id: device.shopId } })
      if (!shop || !shop.isActive) return jsonError(403, 'Shop is suspended')

      const token = randomToken(32)
      const updated = await db.device.update({
        where: { id: device.id },
        data: {
          tokenHash: sha256(token),
          status: 'ACTIVE',
          registeredAt: new Date(),
          lastSeenAt: new Date(),
          pairingCode: null,
          pairingExpiresAt: null,
          machineName: body.machineName,
          appVersion: body.appVersion || null,
        },
      })
      await audit({
        shopId: shop.id,
        actorType: 'DEVICE',
        actorId: device.id,
        action: 'DEVICE_PAIRED',
        entity: 'Device',
        entityId: device.id,
        meta: { machineName: body.machineName, appVersion: body.appVersion },
        ip: getClientIp(req),
      })
      return jsonOk({
        deviceToken: token,
        device: { id: updated.id, name: updated.name },
        shop: { name: shop.name, slug: shop.slug },
      })
    }
  )
}
