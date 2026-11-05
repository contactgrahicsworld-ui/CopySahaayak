// Inspect ALL orders (mansa + sharma) to decide cleanup scope
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/home/z/my-project/.env', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const client = new pg.Client({ connectionString: get('DIRECT_URL'), ssl: { rejectUnauthorized: false } })
await client.connect()
const q = (sql, p) => client.query(sql, p).then(r => r.rows)

const shops = await q(`SELECT id, slug FROM csp."Shop"`)
for (const s of shops) {
  console.log(`\n===== SHOP ${s.slug} (${s.id.slice(0,10)}) =====`)
  const ords = await q(`SELECT "orderNumber", status, "totalPaise", "customerName", "createdAt" FROM csp."Order" WHERE "shopId"=$1 ORDER BY "createdAt" DESC LIMIT 30`, [s.id])
  console.log(`orders: ${ords.length}`)
  for (const o of ords) console.log('-', o.orderNumber, o.status, o.totalPaise, JSON.stringify(o.customerName), o.createdAt.toISOString())
  const cs = await q(`SELECT count(*)::int n FROM csp."CustomerSession" WHERE "shopId"=$1`, [s.id])
  const ds = await q(`SELECT count(*)::int n FROM csp."Document" WHERE "shopId"=$1`, [s.id])
  console.log('customer sessions:', cs[0].n, '| documents:', ds[0].n)
}
await client.end()
console.log('\nDONE')
