// Platform settings (Super Admin): UPI for subscription payments etc.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { platformSettingSchema } from '@/lib/validation'
import { settings } from '@/lib/settings'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'

const ALLOWED_KEYS = ['platform_name', 'super_admin_upi_vpa', 'super_admin_payee_name', 'support_phone', 'order_prefix']

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const all = await settings.all()
    return jsonOk({ settings: Object.fromEntries(ALLOWED_KEYS.map((k) => [k, all[k] || ''])) })
  })
}

export async function PUT(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const body = platformSettingSchema.parse(await req.json())
    if (!ALLOWED_KEYS.includes(body.key)) return jsonError(400, 'Unknown setting key')
    await db.platformSetting.upsert({ where: { key: body.key }, update: { value: body.value }, create: { key: body.key, value: body.value } })
    await settings.invalidate()
    await audit({ userId: ctx.user.id, actorType: 'USER', action: 'PLATFORM_SETTING_UPDATED', entity: 'PlatformSetting', entityId: body.key, ip: getClientIp(req) })
    return jsonOk({ ok: true })
  })
}
