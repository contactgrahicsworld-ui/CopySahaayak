// Public version endpoint polled by the Windows connector (GET, no device token).
// The connector shows an update balloon and opens the download URL when the server
// version is newer than its own. Kept dependency-free (no fs / no GitHub API on the
// hot path) so it cannot fail on a cold serverless instance.
import { handleRoute, jsonOk } from '@/lib/api'
import { RATE_LIMITS } from '@/lib/rate-limit'
import { CONNECTOR_VERSION, CONNECTOR_DOWNLOAD_PATH } from '@/lib/connector-version'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'dlv' }, checkOrigin: false },
    async () =>
      jsonOk({
        version: CONNECTOR_VERSION,
        downloadUrl: CONNECTOR_DOWNLOAD_PATH,
      }),
  )
}
