// Cleanup CopySahaayak production test data — mansa shop only (audit artifacts)
// FK-safe order, precise IDs, prints everything it deletes.
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

const mansa = (await q(`SELECT id FROM csp."Shop" WHERE slug='mansa'`))[0].id

// ---- collect test artifacts (mansa only) ----
const testOrderNumbers = ['PC-2611-0BR1L','PC-2611-0CUQ2','PC-2611-0HX1L','PC-2611-0U99X','PC-2611-0T0DE','PC-2611-098Y2','PC-2611-046PI','PC-2611-0P78C','PC-2611-09AKE','PC-2611-0ET8W','PC-2611-09CI5']
const orders = await q(`SELECT id, "orderNumber" FROM csp."Order" WHERE "shopId"=$1 AND "orderNumber" = ANY($2)`, [mansa, testOrderNumbers])
const orderIds = orders.map(o => o.id)
console.log('orders to delete:', orders.length, orders.map(o=>o.orderNumber).join(', '))

const docs = await q(`SELECT id, "originalName", "storedPath" FROM csp."Document" WHERE "shopId"=$1`, [mansa])
console.log('docs to delete:', docs.length, '(', docs.map(d=>d.originalName).join(', '), ')')
const docIds = docs.map(d => d.id)

const sessions = await q(`SELECT id FROM csp."CustomerSession" WHERE "shopId"=$1`, [mansa])
console.log('customer sessions to delete:', sessions.length)
const sessionIds = sessions.map(s => s.id)

const devices = await q(`SELECT id, name, "machineName", status FROM csp."Device" WHERE "shopId"=$1`, [mansa])
console.log('devices to delete:', devices.length, '(', devices.map(d=>`${d.name}(${d.status})`).join(', '), ')')
const deviceIds = devices.map(d => d.id)

const printers = await q(`SELECT id, "windowsName" FROM csp."Printer" WHERE "shopId"=$1`, [mansa])
console.log('printers to delete:', printers.length, '(', printers.map(p=>p.windowsName).join(', '), ')')

const subpays = await q(`SELECT id, utr, status FROM csp."SubscriptionPayment" WHERE "shopId"=$1`, [mansa])
console.log('subpayments to delete:', subpays.length)
const subpayIds = subpays.map(s => s.id)

// notifications for test orders + test subpayment flow
const nots = await q(`SELECT id, title FROM csp."Notification" WHERE "shopId"='${mansa}' AND (title LIKE 'New order PC-2611-%' OR title LIKE 'Payment submitted for PC-2611-%' OR title LIKE 'Payment verified — PC-2611-%' OR title LIKE 'Payment rejected — PC-2611-%' OR title IN ('Subscription payment submitted','Subscription payment rejected'))`)
console.log('notifications to delete:', nots.length)

// ---- FK-safe deletes ----
console.log('\n-- deleting...')
// 1. print events via jobs (cascade handles), but explicit for clarity
const jobs = orderIds.length ? await q(`SELECT id FROM csp."PrintJob" WHERE "orderId" = ANY($1)`, [orderIds]) : []
if (jobs.length) { const r = await q(`DELETE FROM csp."PrintEvent" WHERE "printJobId" = ANY($1)`, [jobs.map(j=>j.id)]); console.log('print events:', r.rowCount) }
if (jobs.length) { const r = await q(`DELETE FROM csp."PrintJob" WHERE "orderId" = ANY($1)`, [orderIds]); console.log('print jobs:', r.rowCount) }
if (orderIds.length) {
  const r1 = await q(`DELETE FROM csp."PaymentVerification" WHERE "paymentId" IN (SELECT id FROM csp."Payment" WHERE "orderId" = ANY($1))`, [orderIds])
  console.log('payment verifications:', r1.rowCount)
  const r2 = await q(`DELETE FROM csp."Payment" WHERE "orderId" = ANY($1)`, [orderIds]); console.log('payments:', r2.rowCount)
  const r3 = await q(`DELETE FROM csp."OrderItem" WHERE "orderId" = ANY($1)`, [orderIds]); console.log('order items:', r3.rowCount)
  const r4 = await q(`DELETE FROM csp."Order" WHERE id = ANY($1)`, [orderIds]); console.log('orders:', r4.rowCount)
}
if (docIds.length) { const r = await q(`DELETE FROM csp."Document" WHERE id = ANY($1)`, [docIds]); console.log('documents:', r.rowCount) }
if (sessionIds.length) { const r = await q(`DELETE FROM csp."CustomerSession" WHERE id = ANY($1)`, [sessionIds]); console.log('customer sessions:', r.rowCount) }
if (deviceIds.length) { const r = await q(`DELETE FROM csp."Device" WHERE id = ANY($1)`, [deviceIds]); console.log('devices:', r.rowCount) }
if (printers.length) { const r = await q(`DELETE FROM csp."Printer" WHERE id = ANY($1)`, [printers.map(p=>p.id)]); console.log('printers:', r.rowCount) }
if (subpayIds.length) { const r = await q(`DELETE FROM csp."SubscriptionPayment" WHERE id = ANY($1)`, [subpayIds]); console.log('subscription payments:', r.rowCount) }
if (nots.length) { const r = await q(`DELETE FROM csp."Notification" WHERE id = ANY($1)`, [nots.map(n=>n.id)]); console.log('notifications:', r.rowCount) }

// audit entries referencing deleted entities
const entityIds = [...orderIds, ...docIds, ...sessionIds, ...deviceIds, ...printers.map(p=>p.id), ...subpayIds]
if (entityIds.length) {
  const r = await q(`DELETE FROM csp."AuditLog" WHERE "shopId"=$1 AND "entityId" = ANY($2)`, [mansa, entityIds])
  console.log('audit entries (by entityId):', r.rowCount)
}
// audit rows whose metaJson.orderNumber is a test order (entityId was payment/order ids — covered above, but meta-based catch)
const r2 = await q(`DELETE FROM csp."AuditLog" WHERE "shopId"='${mansa}' AND "entityId" IS NULL AND "metaJson" IS NOT NULL AND ("metaJson" LIKE '%PC-2611-0BR1L%' OR "metaJson" LIKE '%PC-2611-0CUQ2%' OR "metaJson" LIKE '%PC-2611-0HX1L%' OR "metaJson" LIKE '%PC-2611-0U99X%' OR "metaJson" LIKE '%PC-2611-0T0DE%' OR "metaJson" LIKE '%PC-2611-098Y2%' OR "metaJson" LIKE '%PC-2611-046PI%' OR "metaJson" LIKE '%PC-2611-0P78C%' OR "metaJson" LIKE '%PC-2611-09AKE%' OR "metaJson" LIKE '%PC-2611-0ET8W%' OR "metaJson" LIKE '%PC-2611-09CI5%')`)
console.log('audit entries (meta orderNumber):', r2.length)

// ---- verify ----
console.log('\n-- verify (mansa should be clean) --')
const v1 = await q(`SELECT count(*)::int n FROM csp."Order" WHERE "shopId"='${mansa}'`); console.log('orders left:', v1[0].n)
const v2 = await q(`SELECT count(*)::int n FROM csp."Document" WHERE "shopId"='${mansa}'`); console.log('documents left:', v2[0].n)
const v3 = await q(`SELECT count(*)::int n FROM csp."Device" WHERE "shopId"='${mansa}'`); console.log('devices left:', v3[0].n)
const v4 = await q(`SELECT count(*)::int n FROM csp."Printer" WHERE "shopId"='${mansa}'`); console.log('printers left:', v4[0].n)
const v5 = await q(`SELECT count(*)::int n FROM csp."SubscriptionPayment" WHERE "shopId"='${mansa}'`); console.log('subpayments left:', v5[0].n)
const v6 = await q(`SELECT count(*)::int n FROM csp."Notification" WHERE "shopId"='${mansa}'`); console.log('notifications left:', v6[0].n)
const v7 = await q(`SELECT count(*)::int n FROM csp."AuditLog" WHERE "shopId"='${mansa}'`); console.log('audit entries left:', v7[0].n)

// sharma untouched sanity
const sharma = (await q(`SELECT id FROM csp."Shop" WHERE slug='sharma'`))[0].id
const s1 = await q(`SELECT count(*)::int n FROM csp."Order" WHERE "shopId"='${sharma}'`); console.log('\nsharma orders (untouched):', s1[0].n)

await client.end()
console.log('\nCLEANUP DONE')
