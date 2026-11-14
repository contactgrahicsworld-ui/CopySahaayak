// Super admin: one-click gateway connectivity test (setup ease). Pings the
// configured YouPI server's /health endpoint server-to-server and reports
// reachability + latency. No secrets are sent anywhere; the platform's API
// key is never used here (health is unauthenticated by design on YouPI).
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireSuper } from '@/lib/auth'
import { getPlatformYoupiConfig } from '@/lib/youpi'
import { audit } from '@/lib/audit'
import { getClientIp } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function POST(req: Request) {
  return handleRoute(req, { rateLimit: { max: 6, windowMs: 60_000, bucket: 'gw-test' } }, async () => {
    const ctx = await requireSuper()
    const cfg = await getPlatformYoupiConfig()
    if (!cfg?.apiUrl) return jsonError(409, 'Gateway server URL pehle Settings me bharein')

    const started = Date.now()
    try {
      const res = await fetch(`${cfg.apiUrl}/health`, { signal: AbortSignal.timeout(8000) })
      const latencyMs = Date.now() - started
      let bodyText = ''
      try {
        bodyText = (await res.text()).slice(0, 200)
      } catch {
        bodyText = ''
      }
      let up = res.ok
      try {
        const parsed = JSON.parse(bodyText || '{}') as { status?: string }
        if (parsed.status) up = up && parsed.status.toUpperCase() === 'UP'
      } catch {
        // non-JSON health body — HTTP status decides
      }
      await audit({ userId: ctx.user.id, actorType: 'USER', action: 'GATEWAY_TEST', entity: 'PlatformSetting', entityId: 'youpi_api_url', meta: { ok: up, latencyMs }, ip: getClientIp(req) })
      return jsonOk({
        ok: up,
        httpStatus: res.status,
        latencyMs,
        bodySample: bodyText,
        hint: up ? 'Gateway server UP — webhook URL aur merchant credentials check karke ₹1 test karein.' : 'Server pahunch raha hai par health UP nahi bata raha — YouPI services aur domain/SSL check karein.',
      })
    } catch (err) {
      const latencyMs = Date.now() - started
      await audit({ userId: ctx.user.id, actorType: 'USER', action: 'GATEWAY_TEST', entity: 'PlatformSetting', entityId: 'youpi_api_url', meta: { ok: false, latencyMs }, ip: getClientIp(req) })
      return jsonOk({
        ok: false,
        httpStatus: null,
        latencyMs,
        bodySample: '',
        hint: `Server tak nahi pahuncha (${err instanceof Error ? err.message : 'network error'}). URL, DNS aur SSL check karein — YouPI server chal raha hona chahiye.`,
      })
    }
  })
}
