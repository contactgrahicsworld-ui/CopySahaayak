// Remove the timer-verification test shop and its owner from prod DB.
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/tmp/vercel-env-cli.txt', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const url = get('DIRECT_URL') || get('DATABASE_URL')
const SLUG = process.argv[2]
if (!SLUG) { console.error('usage: node scripts/cleanup-test-shop.mjs <slug>'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = async (sql, p) => (await client.query(sql, p)).rows

const shop = (await q(`SELECT id FROM csp."Shop" WHERE slug=$1`, [SLUG]))[0]
if (!shop) { console.log('shop not found — nothing to clean'); await client.end(); process.exit(0) }
const users = await q(`SELECT id, email FROM csp."User" WHERE "shopId"=$1`, [shop.id])
console.log('users to delete:', users.map(u => u.email).join(', '))

// Sessions/audit rows first (no cascade), then user, then shop (cascades the rest).
for (const u of users) {
  await q(`DELETE FROM csp."Session" WHERE "userId"=$1`, [u.id])
  await q(`DELETE FROM csp."AuditLog" WHERE "userId"=$1`, [u.id])
  await q(`DELETE FROM csp."User" WHERE id=$1`, [u.id])
}
const res = await q(`DELETE FROM csp."Shop" WHERE id=$1 RETURNING slug`, [shop.id])
console.log('deleted shop:', res.map(r => r.slug).join(', '))

// Confirm zero residue
const left = await q(`SELECT count(*)::int AS n FROM csp."Shop" WHERE slug LIKE 'timercheck-%'`)
console.log('remaining timercheck shops:', left[0].n)
await client.end()
