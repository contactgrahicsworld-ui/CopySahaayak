// Delete ONLY my test orders (test customer names) + their documents/payments.
// Real customer orders (deepak, Naresh, Sonu, unnamed real scans) are KEPT.
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
const run = (sql, p) => client.query(sql, p)

const testNames = ['Browser Test Customer', 'Test Customer', 'UPI Verify Test', 'E2E Customer A', 'E2E Customer B']
const orders = await q(`SELECT o.id, o."orderNumber", o."customerName" FROM csp."Order" o WHERE o."customerName" = ANY($1)`, [testNames])
console.log('test orders to delete:', orders.map(o => `${o.orderNumber}(${o.customerName})`).join(', '))

await run('BEGIN')
try {
  for (const o of orders) {
    // FK-safe order: print jobs (cascade their events) → order items → payments → documents → order
    await run(`DELETE FROM csp."PrintJob" WHERE "orderId"=$1`, [o.id]) // PrintEvents cascade
    await run(`DELETE FROM csp."Payment" WHERE "orderId"=$1`, [o.id])
    await run(`DELETE FROM csp."OrderItem" WHERE "orderId"=$1`, [o.id])
    const docs = await q(`DELETE FROM csp."Document" WHERE "orderId"=$1 RETURNING id`, [o.id])
    await run(`DELETE FROM csp."AuditLog" WHERE "entityId"=$1 AND "entity"='Order'`, [o.id])
    await run(`DELETE FROM csp."Order" WHERE id=$1`, [o.id])
    console.log(`- deleted ${o.orderNumber} (${docs.length} docs)`)
  }
  // also clean orphan test documents (test upload artifacts not tied to kept orders)
  await run(`DELETE FROM csp."PrintJob" WHERE "documentId" IN (SELECT id FROM csp."Document" WHERE lower("originalName") LIKE 'test-%' OR lower("originalName") LIKE 'e2e-%' OR lower("originalName") LIKE 'sample-%')`)
  await run(`DELETE FROM csp."OrderItem" WHERE "documentId" IN (SELECT id FROM csp."Document" WHERE lower("originalName") LIKE 'test-%' OR lower("originalName") LIKE 'e2e-%' OR lower("originalName") LIKE 'sample-%')`)
  const testDocs = await q(`DELETE FROM csp."Document" WHERE (lower("originalName") LIKE 'test-%' OR lower("originalName") LIKE 'e2e-%' OR lower("originalName") LIKE 'sample-%') AND "orderId" IS NULL RETURNING "originalName", "shopId"`)
  for (const d of testDocs) console.log(`- deleted test doc: ${d.originalName}`)
  await run('COMMIT')
  console.log('COMMITTED')
} catch (e) {
  await run('ROLLBACK')
  console.error('ROLLBACK:', e.message)
  process.exit(1)
}

const left = await q(`SELECT s.slug, count(o.id)::int AS n FROM csp."Shop" s LEFT JOIN csp."Order" o ON o."shopId"=s.id GROUP BY s.slug`)
for (const l of left) console.log(`remaining orders on ${l.slug}: ${l.n}`)
const docsLeft = await q(`SELECT s.slug, count(d.id)::int AS n, COALESCE(sum(d."sizeBytes"),0)::bigint AS bytes FROM csp."Shop" s LEFT JOIN csp."Document" d ON d."shopId"=s.id GROUP BY s.slug`)
for (const d of docsLeft) console.log(`remaining docs on ${d.slug}: ${d.n} (${d.bytes} bytes)`)
await client.end()
