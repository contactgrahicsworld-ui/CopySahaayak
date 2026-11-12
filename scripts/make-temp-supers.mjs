// Create two disposable SUPER_ADMIN test accounts (live DELETE-flow testing).
// Caller deletes them right after via the DELETE API — nothing else touched.
import { readFileSync } from 'fs'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const envText = readFileSync('/tmp/vercel-env-cli.txt', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const url = get('DIRECT_URL') || get('DATABASE_URL')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = async (sql, p) => (await client.query(sql, p)).rows

const accounts = [
  { email: 'tempdel-a@check.local', password: 'TempDel#1x', name: 'Temp A' },
  { email: 'tempdel-b@check.local', password: 'TempDel#2x', name: 'Temp B' },
]
for (const a of accounts) {
  const hash = await bcrypt.hash(a.password, 10)
  await q(
    `INSERT INTO csp."User" (id, email, "passwordHash", name, role, "isActive", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'SUPER_ADMIN', true, now(), now())`,
    [a.email, hash, a.name]
  )
}
const supers = await q(`SELECT email FROM csp."User" WHERE role='SUPER_ADMIN' ORDER BY "createdAt"`)
console.log('supers NOW:', supers.map((r) => r.email).join(', '))
await client.end()
