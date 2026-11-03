// Verify the shared rate-limit table works on production DB.
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/tmp/vercel-env.txt', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const url = get('DIRECT_URL')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const q = async (sql, params) => (await client.query(sql, params)).rows

// 1. Table exists?
const tables = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='csp' AND table_name='RateLimitEntry'`)
console.log('table exists:', tables.length === 1)

// 2. Simulate the app's upsert (pooled-style logic)
const key = 'login:probe-test'
const now = new Date()
const expires = new Date(now.getTime() + 15 * 60 * 1000)
for (let i = 1; i <= 12; i++) {
  const rows = await q(
    `INSERT INTO csp."RateLimitEntry" ("key","count","windowExpiresAt")
     VALUES ($1, 1, $2)
     ON CONFLICT ("key") DO UPDATE SET
       "count" = CASE WHEN csp."RateLimitEntry"."windowExpiresAt" < $3 THEN 1 ELSE csp."RateLimitEntry"."count" + 1 END,
       "windowExpiresAt" = CASE WHEN csp."RateLimitEntry"."windowExpiresAt" < $3 THEN $2 ELSE csp."RateLimitEntry"."windowExpiresAt" END
     RETURNING "count", "windowExpiresAt"`,
    [key, expires, now]
  )
  if (i === 1 || i === 10 || i === 11) console.log(`attempt ${i}: count=${rows[0].count}`)
}

// 3. Read rows
const probe = await q(`SELECT key, count FROM csp."RateLimitEntry" WHERE key LIKE 'login:%' ORDER BY key`)
console.log('login rows in table:', JSON.stringify(probe))

// 4. Cleanup probe
await q(`DELETE FROM csp."RateLimitEntry" WHERE key = $1`, [key])
console.log('probe cleaned')
await client.end()
