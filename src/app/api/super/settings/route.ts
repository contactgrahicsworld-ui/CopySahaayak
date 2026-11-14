// Platform settings (Super Admin): UPI for subscription payments, YouPI PG
// gateway credentials (subscription payments + shared gateway base URL).
// Secrets (api key / webhook secret) are write-only: GET never returns them.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { platformSettingSchema } from '@/lib/validation'
import { settings } from '@/lib/settings'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'
import { youpiSettingKeys } from '@/lib/youpi'

export const dynamic = 'force-dynamic'

const ALLOWED_KEYS = ['platform_name', 'super_admin_upi_vpa', 'super_admin_payee_name', 'support_phone', 'order_prefix']
const YOUPY_WRITE_ONLY_KEYS = ['youpi_merchant_api_key', 'youpi_webhook_secret']
const YOUPY_KEYS = youpiSettingKeys() // api_url, merchant_id, public_key, accept_observed + the two secrets

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    await requireSuper()
    const all = await settings.all()
    const plain = Object.fromEntries(ALLOWED_KEYS.map((k) => [k, all[k] || '']))
    const gateway = Object.fromEntries(
      YOUPY_KEYS.map((k) => {
        if (YOUPY_WRITE_ONLY_KEYS.includes(k)) return [k, all[k] ? '********' : '']
        return [k, all[k] || '']
      })
    )
    return jsonOk({ settings: { ...plain, ...gateway } })
  })
}

export async function PUT(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireSuper()
    const body = platformSettingSchema.parse(await req.json())
    if (!ALLOWED_KEYS.includes(body.key) && !YOUPY_KEYS.includes(body.key)) return jsonError(400, 'Unknown setting key')
    // A masked value round-trips unchanged — never overwrite a stored secret
    // with the display placeholder.
    const value = YOUPY_WRITE_ONLY_KEYS.includes(body.key) && body.value === '********' ? undefined : body.value
    if (value !== undefined) {
      await db.platformSetting.upsert({ where: { key: body.key }, update: { value }, create: { key: body.key, value } })
      await settings.invalidate()
    }
    await audit({ userId: ctx.user.id, actorType: 'USER', action: 'PLATFORM_SETTING_UPDATED', entity: 'PlatformSetting', entityId: body.key, ip: getClientIp(req) })
    return jsonOk({ ok: true })
  })
}
