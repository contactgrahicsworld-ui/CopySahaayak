// Public version endpoint polled by the Windows connector (GET, no device token).
// The connector compares `version` with its own and offers a one-click self-update:
// it downloads `downloadUrl`, checks `sha256` when present, runs the installer
// silently and restarts itself. Kept dependency-free (no fs / no GitHub API on the
// hot path) so it cannot fail on a cold serverless instance.
import { handleRoute, jsonOk } from '@/lib/api'
import { RATE_LIMITS } from '@/lib/rate-limit'
import {
  CONNECTOR_VERSION,
  CONNECTOR_DOWNLOAD_PATH,
  CONNECTOR_SETUP_SHA256,
  CONNECTOR_SETUP_SIZE_BYTES,
} from '@/lib/connector-version'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(
    req,
    { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'dlv' }, checkOrigin: false },
    async () => {
      const body: Record<string, unknown> = {
        version: CONNECTOR_VERSION,
        downloadUrl: CONNECTOR_DOWNLOAD_PATH,
      }
      // Only advertise integrity data that was actually verified by the release
      // pipeline — the connector treats a missing sha256 as "skip verification".
      if (CONNECTOR_SETUP_SHA256) body.sha256 = CONNECTOR_SETUP_SHA256
      if (CONNECTOR_SETUP_SIZE_BYTES > 0) body.sizeBytes = CONNECTOR_SETUP_SIZE_BYTES
      return jsonOk(body)
    },
  )
}
