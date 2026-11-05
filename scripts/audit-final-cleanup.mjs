// Final cleanup: browser-test artifacts + revoked devices (sharma)
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/home/z/my-project/.env', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const client = new pg.Client({ connectionString: get('DIRECT_URL'), ssl: { rejectUnauthorized: false } })
await client.connect()
const q = (sql, p) => client.query(sql, p).then(r => ({ n: r.rowCount, rows: r.rows }))

// --- mansa: browser-test order + pending device ---
const ord = await q(`SELECT id, "orderNumber" FROM csp."Order" WHERE "orderNumber"='PC-2611-0C8QN'`)
console.log('browser test order:', ord.rows)
if (ord.rows.length) {
  const oid = ord.rows[0].id
  const jobs = await q(`SELECT id FROM csp."PrintJob" WHERE "orderId"=$1`, [oid])
  if (jobs.rows.length) await q(`DELETE FROM csp."PrintEvent" WHERE "printJobId" = ANY($1)`, [jobs.rows.map(j=>j.id)])
  await q(`DELETE FROM csp."PrintJob" WHERE "orderId"=$1`, [oid])
  await q(`DELETE FROM csp."PaymentVerification" WHERE "paymentId" IN (SELECT id FROM csp."Payment" WHERE "orderId"=$1)`, [oid])
  await q(`DELETE FROM csp."Payment" WHERE "orderId"=$1`, [oid])
  await q(`DELETE FROM csp."OrderItem" WHERE "orderId"=$1`, [oid])
  await q(`DELETE FROM csp."Document" WHERE "orderId"=$1`, [oid])
  await q(`DELETE FROM csp."Order" WHERE id=$1`, [oid])
  console.log('deleted order PC-2611-0C8QN + children')
}
// pending device from pairing-dialog test
const pend = await q(`DELETE FROM csp."Device" WHERE "shopId"=(SELECT id FROM csp."Shop" WHERE slug='mansa') AND status='PENDING'`)
console.log('pending devices deleted:', pend.n)
// orphan docs/sessions left from browser test
const sess = await q(`SELECT id FROM csp."CustomerSession" WHERE "shopId"=(SELECT id FROM csp."Shop" WHERE slug='mansa')`)
if (sess.rows.length) {
  await q(`DELETE FROM csp."Document" WHERE "customerSessionId" = ANY($1) AND "orderId" IS NULL`, [sess.rows.map(s=>s.id)])
  const d2 = await q(`DELETE FROM csp."CustomerSession" WHERE id = ANY($1)`, [sess.rows.map(s=>s.id)])
  console.log('mansa sessions deleted:', d2.n)
}
// mansa orphan audit
await q(`DELETE FROM csp."AuditLog" WHERE "shopId"=(SELECT id FROM csp."Shop" WHERE slug='mansa') AND action NOT IN ('LOGIN','PASSWORD_RESET_REQUESTED','CREDENTIALS_ROTATED') AND ("entityId" IS NULL OR "entityId" NOT IN (SELECT id FROM (SELECT id FROM csp."Order" UNION SELECT id FROM csp."Payment" UNION SELECT id FROM csp."PrintJob" UNION SELECT id FROM csp."Document" UNION SELECT id FROM csp."Device" UNION SELECT id FROM csp."Printer" UNION SELECT id FROM csp."SubscriptionPayment" UNION SELECT id FROM csp."Shop" UNION SELECT id FROM csp."User") live))`)
// mansa test notifications
await q(`DELETE FROM csp."Notification" WHERE "shopId"=(SELECT id FROM csp."Shop" WHERE slug='mansa') AND (title LIKE 'New order PC-2611-%' OR title LIKE 'Payment %PC-2611-%')`)

// --- sharma: delete REVOKED devices only (real orders untouched) ---
const shRevoked = await q(`SELECT id, name, status FROM csp."Device" WHERE "shopId"=(SELECT id FROM csp."Shop" WHERE slug='sharma')`)
console.log('sharma devices:', shRevoked.rows.map(d => `${d.name}:${d.status}`).join(', '))
const delRev = await q(`DELETE FROM csp."Device" WHERE "shopId"=(SELECT id FROM csp."Shop" WHERE slug='sharma') AND status='REVOKED'`)
console.log('sharma revoked devices deleted:', delRev.n)
const shPend = await q(`DELETE FROM csp."Device" WHERE "shopId"=(SELECT id FROM csp."Shop" WHERE slug='sharma') AND status='PENDING' AND "pairingExpiresAt" < now()`)
console.log('sharma expired pending devices deleted:', shPend.n)
// sharma orphan audit for revoked devices
await q(`DELETE FROM csp."AuditLog" WHERE "shopId"=(SELECT id FROM csp."Shop" WHERE slug='sharma') AND action NOT IN ('LOGIN','PASSWORD_RESET_REQUESTED','CREDENTIALS_ROTATED') AND ("entityId" IS NULL OR "entityId" NOT IN (SELECT id FROM (SELECT id FROM csp."Order" UNION SELECT id FROM csp."Payment" UNION SELECT id FROM csp."PrintJob" UNION SELECT id FROM csp."Document" UNION SELECT id FROM csp."Device" UNION SELECT id FROM csp."Printer" UNION SELECT id FROM csp."SubscriptionPayment" UNION SELECT id FROM csp."Shop" UNION SELECT id FROM csp."User") live))`)
console.log('sharma orphan audit cleaned')

// --- final verification ---
const v = await q(`SELECT s.slug,
  (SELECT count(*)::int FROM csp."Order" o WHERE o."shopId"=s.id) orders,
  (SELECT count(*)::int FROM csp."Device" d WHERE d."shopId"=s.id) devices,
  (SELECT count(*)::int FROM csp."Printer" p WHERE p."shopId"=s.id) printers,
  (SELECT count(*)::int FROM csp."Document" doc WHERE doc."shopId"=s.id) docs
  FROM csp."Shop" s ORDER BY s.slug`)
console.log('\nFINAL STATE:')
for (const r of v.rows) console.log('-', r.slug, '| orders:', r.orders, '| devices:', r.devices, '| printers:', r.printers, '| docs:', r.docs)

await client.end()
console.log('\nFINAL CLEANUP DONE')
