// Serves the Windows connector installer.
// Priority: local artifact on disk (self-hosted builds) → redirect to the
// GitHub-hosted installer (kept in-repo; under the 100 MB Git limit).
import fs from 'fs'
import path from 'path'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { RATE_LIMITS } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const INSTALLER_NAME = 'DesktopSahaayak-Setup.exe'
const GITHUB_RAW = process.env.CONNECTOR_DOWNLOAD_URL || 'https://github.com/contactgrahicsworld-ui/CopySahaayak/releases/download/connector-v1.3.0/DesktopSahaayak-Setup.exe'

function findInstaller(): string | null {
  const candidates = [
    process.env.CONNECTOR_SETUP_EXE,
    path.join(process.cwd(), 'download', 'connector', INSTALLER_NAME),
    path.join(process.cwd(), 'connector', 'installer', INSTALLER_NAME),
    // standalone output keeps the original cwd inside .next/standalone
    path.join(process.cwd(), '..', '..', 'connector', 'installer', INSTALLER_NAME),
    // legacy artifact names kept as fallback so an in-flight deployment keeps
    // serving the previous installer until the new release is published
    path.join(process.cwd(), 'connector', 'installer', 'PrintSahayak-Setup.exe'),
    path.join(process.cwd(), '..', '..', 'connector', 'installer', 'PrintSahayak-Setup.exe'),
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
    } catch {}
  }
  return null
}

export async function GET(req: Request) {
  return handleRoute(req, { rateLimit: { ...RATE_LIMITS.readPublic, bucket: 'dl' }, checkOrigin: false }, async () => {
    const file = findInstaller()
    if (file) {
      const stat = fs.statSync(file)
      // Serve under the artifact's real name (legacy fallback keeps its name too).
      const fileName = path.basename(file)
      const stream = fs.createReadStream(file) as unknown as ReadableStream
      return new Response(stream, {
        headers: {
          'Content-Type': 'application/vnd.microsoft.portable-executable',
          'Content-Length': String(stat.size),
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      })
    }
    if (process.env.CONNECTOR_DOWNLOAD_URL !== 'off') {
      // GitHub-hosted fallback (redirect keeps serverless bundles small)
      return new Response(null, {
        status: 302,
        headers: { Location: GITHUB_RAW, 'Cache-Control': 'no-store' },
      })
    }
    return jsonError(404, 'Connector installer is not yet available on this deployment')
  })
}
