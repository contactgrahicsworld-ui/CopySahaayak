import { db } from '@/lib/db'
import { handleRoute, jsonOk } from '@/lib/api'
import { IS_INSECURE_SECRET } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    let dbOk = false
    try {
      await db.$queryRaw`SELECT 1`
      dbOk = true
    } catch {
      dbOk = false
    }
    return jsonOk({
      status: dbOk ? 'healthy' : 'degraded',
      database: dbOk ? 'up' : 'down',
      secretConfigured: !IS_INSECURE_SECRET,
      time: new Date().toISOString(),
    })
  })
}
