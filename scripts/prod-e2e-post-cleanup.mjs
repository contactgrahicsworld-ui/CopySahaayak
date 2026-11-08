// Post-E2E cleanup on production: removes every artifact the e2e battery created
// (unique RUN-suffixed test data), leaving the 4 real shops + fresh super intact.
import { readFileSync } from 'fs'
import pg from 'pg'

let DBPASS = ''
for (const p of ['/home/z/my-project/scripts/.dbpass', '/tmp/my-project/.dbpass']) {
  try { DBPASS = readFileSync(p, 'utf8').trim(); if (DBPASS) break } catch { /* next */ }
}
if (!DBPASS) { console.error('dbpass not found'); process.exit(1) }
const client = new pg.Client({
  connectionString: 'postgresql://postgres.oqowxmrzaxnundghsrct:' + encodeURIComponent(DBPASS) + '@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
})
await client.connect()
const q = (sql, p) => client.query(sql, p).then((r) => r.rows)

const testEmails = await q(`SELECT id, email FROM csp."User" WHERE email ~ '(e2e\\.|owner\\.[ab]\\.|weak\\.|handover|handed)' OR email LIKE '%@testshop-test.in' OR email LIKE '%@copysahaayak-test.in' OR email LIKE '%@nowhere.in' OR email LIKE '%@x.in' OR email LIKE '%@verify-test.com%' OR email LIKE '%@setup-verify.%' OR email LIKE '%@testsuper-test.in'`)
const testShopSlugs = await q(`SELECT id, slug FROM csp."Shop" WHERE slug LIKE 'e2e-%' OR slug LIKE 'weak-%' OR name LIKE 'E2E Xerox%'`)
console.log('test users to delete:', testEmails.map((u) => u.email))
console.log('test shops to delete:', testShopSlugs.map((s) => s.slug))

await client.query('BEGIN')
try {
  const shopIds = testShopSlugs.map((s) => s.id)
  if (shopIds.length) {
    // Leaf-first within test shops (FK-safe)
    for (const t of ['PrintEvent', 'PrintJob', 'RoutingRule', 'OrderItem', 'PaymentVerification', 'Payment', 'Order', 'Document', 'StoredObject', 'Notification', 'WeeklyReport', 'PricingRule', 'CustomerSession', 'Device', 'Printer', 'ShopMember', 'Subscription', 'SubscriptionPayment', 'OwnershipTransfer']) {
      const r = await q(`DELETE FROM csp."${t}" WHERE "shopId" = ANY($1)`, [shopIds])
      if (r.length) console.log(`  shop-scoped ${t}: ${r.length}`)
    }
    const s = await q(`DELETE FROM csp."Shop" WHERE id = ANY($1) RETURNING slug`, [shopIds])
    console.log('shops deleted:', s.map((x) => x.slug).join(', '))
  }
  const userIds = testEmails.map((u) => u.id)
  if (userIds.length) {
    const l1 = await q(`DELETE FROM csp."AuditLog" WHERE "userId" = ANY($1)`, [userIds])
    console.log('test audit logs:', l1.length)
    const u = await q(`DELETE FROM csp."User" WHERE id = ANY($1) RETURNING email`, [userIds])
    console.log('test users deleted:', u.map((x) => x.email).join(', '))
  }
  // Transfer rows created by the e2e (any remaining, by test-ish target emails)
  const tr = await q(`DELETE FROM csp."OwnershipTransfer" WHERE "toEmail" LIKE '%@testshop-test.in' OR "toEmail" LIKE '%@copysahaayak-test.in' OR "toEmail" LIKE '%@nowhere.in' OR "toEmail" LIKE '%@x.in' RETURNING id`)
  console.log('test transfers deleted:', tr.length)
  // Brute-force test sessions/otp rows
  const otp = await q(`DELETE FROM csp."PasswordResetOtp" WHERE email LIKE '%@nowhere.in%' OR email LIKE '%@testshop-test.in%' OR email LIKE '%@copysahaayak-test.in%' RETURNING id`)
  console.log('test otp rows deleted:', otp.length)
  await client.query('COMMIT')
  console.log('CLEANUP COMMITTED')
} catch (e) {
  await client.query('ROLLBACK')
  console.error('ROLLBACK:', e.message)
  process.exit(1)
}

const final = await q(`SELECT (SELECT count(*) FROM csp."User") users, (SELECT count(*) FROM csp."Shop") shops, (SELECT count(*) FROM csp."Order") orders, (SELECT count(*) FROM csp."User" WHERE role='SUPER_ADMIN') supers`)
console.log('FINAL STATE:', JSON.stringify(final[0]))
await client.end()
