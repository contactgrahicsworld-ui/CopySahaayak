// Devices (Windows connectors): list, issue pairing codes, revoke.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { randomCode } from '@/lib/security'
import { LIMITS } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const devices = await db.device.findMany({
      where: { shopId: ctx.user.shopId },
      include: { printers: { select: { id: true, windowsName: true, colorMode: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return jsonOk({ devices })
  })
}

const createSchema = z.object({ name: z.string().trim().max(60).optional() })

export async function POST(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const body = createSchema.safeParse(await req.json().catch(() => ({})))
    const name = body.success && body.data.name ? body.data.name : `Connector ${new Date().toLocaleDateString('en-IN')}`

    // Subscription device limit
    const sub = await db.subscription.findUnique({ where: { shopId: ctx.user.shopId }, include: { plan: true } })
    if (sub?.plan.maxDevices != null) {
      const active = await db.device.count({ where: { shopId: ctx.user.shopId, status: { in: ['PENDING', 'ACTIVE'] } } })
      if (active >= sub.plan.maxDevices) {
        return jsonError(402, `Your ${sub.plan.name} plan allows ${sub.plan.maxDevices} device(s). Upgrade to add more.`)
      }
    }

    const code = randomCode(6)
    const device = await db.device.create({
      data: {
        shopId: ctx.user.shopId,
        name,
        pairingCode: code,
        pairingExpiresAt: new Date(Date.now() + LIMITS.pairingCodeTtlMs),
        status: 'PENDING',
      },
    })
    await audit({
      shopId: ctx.user.shopId,
      userId: ctx.user.id,
      actorType: 'USER',
      action: 'DEVICE_PAIRING_CODE_ISSUED',
      entity: 'Device',
      entityId: device.id,
      ip: getClientIp(req),
    })
    const origin = new URL(req.url).origin
    return jsonOk({
      device: { id: device.id, name: device.name, pairingCode: code, expiresAt: device.pairingExpiresAt, status: device.status },
      deepLink: `printsahayak://pair?server=${encodeURIComponent(origin)}&code=${code}`,
    })
  })
}
