// Serves the Windows connector installer. The artifact is produced by
// scripts/build-connector.sh (or the GitHub Actions workflow) and picked up
// from disk — the path is configurable via CONNECTOR_SETUP_EXE for deployments.
import fs from 'fs'
import path from 'path'
import { handleRoute, jsonError } from '@/lib/api'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

function findInstaller(): string | null {
  const candidates = [
    process.env.CONNECTOR_SETUP_EXE,
    path.join(process.cwd(), 'download', 'connector', 'PhotocopyShopConnector-Setup.exe'),
    path.join(process.cwd(), 'connector', 'installer', 'PhotocopyShopConnector-Setup.exe'),
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'dl' }, checkOrigin: false }, async () => {
    const file = findInstaller()
    if (!file) return jsonError(404, 'Connector installer is not yet available on this deployment')
    const stat = fs.statSync(file)
    const stream = fs.createReadStream(file) as unknown as ReadableStream
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/vnd.microsoft.portable-executable',
        'Content-Length': String(stat.size),
        'Content-Disposition': 'attachment; filename="PhotocopyShopConnector-Setup.exe"',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })
}
