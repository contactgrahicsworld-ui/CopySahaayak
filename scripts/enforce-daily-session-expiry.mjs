// Interim daily-session-expiry enforcement (runs until the new build with native
// 24h TTL is deployed; after that it stays as a harmless safety net).
// Revokes every admin session older than 24h, counting from session creation —
// so no matter what TTL the deployed code issues, a session never lives past 24h.
import { readFileSync } from 'fs'
import pg from 'pg'

let DBPASS = ''
for (const p of ['/home/z/my-project/scripts/.dbpass', '/tmp/my-project/.dbpass']) {
  try { DBPASS = readFileSync(p, 'utf8').trim(); if (DBPASS) break } catch { /* try next */ }
}
if (!DBPASS) { console.error('dbpass not found'); process.exit(1) }
const client = new pg.Client({
  connectionString: 'postgresql://postgres.oqowxmrzaxnundghsrct:' + encodeURIComponent(DBPASS) + '@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
})
await client.connect()
const r = await client.query(
  `UPDATE csp."Session" SET "revokedAt"=now()
   WHERE "revokedAt" IS NULL AND "expiresAt" > now() AND "createdAt" < now() - interval '24 hours'
   RETURNING id`,
)
console.log(new Date().toISOString(), '| daily expiry: revoked', r.rowCount, 'session(s) older than 24h')
await client.end()
