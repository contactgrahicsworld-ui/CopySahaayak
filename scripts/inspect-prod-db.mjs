// Inspect production DB contents (read-only) to decide if it's fresh/E2E residue.
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/tmp/vercel-env.txt', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const url = get('DIRECT_URL') || get('DATABASE_URL')
if (!url) { console.error('No DIRECT_URL found'); process.exit(1) }
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const q = async (sql) => (await client.query(sql)).rows

const users = await q(`SELECT email, name, role, "isActive", "createdAt" FROM csp."User" ORDER BY "createdAt"`)
console.log('USERS:', JSON.stringify(users, null, 1))
const shops = await q(`SELECT name, slug, "isActive", "createdAt" FROM csp."Shop" ORDER BY "createdAt"`)
console.log('SHOPS:', JSON.stringify(shops, null, 1))
const orders = await q(`SELECT count(*)::int AS n FROM csp."Order"`)
console.log('ORDERS:', orders[0].n)
const payments = await q(`SELECT count(*)::int AS n FROM csp."Payment"`)
console.log('PAYMENTS:', payments[0].n)
const docs = await q(`SELECT count(*)::int AS n FROM csp."Document"`)
console.log('DOCUMENTS:', docs[0].n)
const devices = await q(`SELECT count(*)::int AS n FROM csp."Device"`)
console.log('DEVICES:', devices[0].n)
await client.end()
