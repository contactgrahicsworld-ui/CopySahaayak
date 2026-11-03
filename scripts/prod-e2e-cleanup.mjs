// Targeted production cleanup after E2E runs.
// Deletes ONLY E2E-created data (shops with slug matching ^e2e-[a-z]-[a-z0-9]+$
// and users on test domains). Preserves real shops, real users, platform settings.
// Usage: bun scripts/prod-e2e-cleanup.mjs
import 'dotenv/config'
import pg from 'pg'

const client = new pg.Client({ connectionString: process.env.DIRECT_URL })

async function main() {
  await client.connect()
  const q = (text, params) => client.query(text, params)

  // 1. identify E2E shops
  const shops = await q(`SELECT id, slug FROM csp."Shop" WHERE slug ~ '^e2e-[a-z]-[a-z0-9]+$'`)
  const shopIds = shops.rows.map(r => r.id)
  console.log(`E2E shops: ${shops.rows.map(r => r.slug).join(', ') || '(none)'}`)

  if (shopIds.length) {
    const S = shopIds.map((_, i) => `$${i + 1}`).join(',')
    const steps = [
      ['PrintEvent', `DELETE FROM csp."PrintEvent" WHERE "shopId" IN (${S})`],
      ['PrintJob', `DELETE FROM csp."PrintJob" WHERE "shopId" IN (${S})`],
      ['Notification', `DELETE FROM csp."Notification" WHERE "shopId" IN (${S})`],
      ['PaymentVerification', `DELETE FROM csp."PaymentVerification" WHERE "paymentId" IN (SELECT id FROM csp."Payment" WHERE "shopId" IN (${S}))`],
      ['Payment', `DELETE FROM csp."Payment" WHERE "shopId" IN (${S})`],
      ['OrderItem', `DELETE FROM csp."OrderItem" WHERE "shopId" IN (${S})`],
      ['Order', `DELETE FROM csp."Order" WHERE "shopId" IN (${S})`],
      ['Document', `DELETE FROM csp."Document" WHERE "shopId" IN (${S})`],
      ['CustomerSession', `DELETE FROM csp."CustomerSession" WHERE "shopId" IN (${S})`],
      ['Printer', `DELETE FROM csp."Printer" WHERE "shopId" IN (${S})`],
      ['Device', `DELETE FROM csp."Device" WHERE "shopId" IN (${S})`],
      ['RoutingRule', `DELETE FROM csp."RoutingRule" WHERE "shopId" IN (${S})`],
      ['PricingRule', `DELETE FROM csp."PricingRule" WHERE "shopId" IN (${S})`],
      ['ShopMember', `DELETE FROM csp."ShopMember" WHERE "shopId" IN (${S})`],
      ['Subscription', `DELETE FROM csp."Subscription" WHERE "shopId" IN (${S})`],
      ['StoredObject', `DELETE FROM csp."StoredObject" WHERE key IN (SELECT "storedPath" FROM csp."Document" WHERE "shopId" IN (${S}))`],
    ]
    for (const [name, sql] of steps) {
      const del = await q(sql, shopIds)
      console.log(`${name}: -${del.rowCount}`)
    }
    const delShop = await q(`DELETE FROM csp."Shop" WHERE id IN (${S})`, shopIds)
    console.log(`Shop: -${delShop.rowCount}`)
  }

  // 2. E2E users
  const users = await q(
    `SELECT id, email FROM csp."User"
     WHERE email LIKE '%@testshop-test.in'
        OR email LIKE 'super.e2e.%'
        OR email LIKE '%@copysahaayak-test.in'`
  )
  const userIds = users.rows.map(r => r.id)
  console.log(`E2E users: ${users.rows.map(r => r.email).join(', ') || '(none)'}`)

  if (userIds.length) {
    const U = userIds.map((_, i) => `$${i + 1}`).join(',')
    for (const t of ['Session']) {
      const del = await q(`DELETE FROM csp."${t}" WHERE "userId" IN (${U})`, userIds)
      console.log(`${t}: -${del.rowCount}`)
    }
    const emails = users.rows.map(r => r.email)
    const E = emails.map((_, i) => `$${i + 1}`).join(',')
    const delOtp = await q(`DELETE FROM csp."PasswordResetOtp" WHERE email IN (${E})`, emails)
    console.log(`PasswordResetOtp: -${delOtp.rowCount}`)
    const delAudit = await q(
      `DELETE FROM csp."AuditLog" WHERE "userId" IN (${U}) OR "actorId" IN (${U})`,
      userIds
    )
    console.log(`AuditLog: -${delAudit.rowCount}`)
    const delU = await q(`DELETE FROM csp."User" WHERE id IN (${U})`, userIds)
    console.log(`User: -${delU.rowCount}`)
  }

  // 3. stray rate-limit rows
  const rl = await q(`DELETE FROM csp."RateLimitEntry" WHERE key LIKE '%testshop-test.in%' OR key LIKE 'super.e2e.%' OR key LIKE '%copysahaayak-test.in%'`)
  console.log(`RateLimitEntry(stray): -${rl.rowCount}`)

  // 4. final state
  const remain = await q(`SELECT slug FROM csp."Shop"`)
  const supers = await q(`SELECT email FROM csp."User" WHERE role='SUPER_ADMIN'`)
  console.log('remaining shops:', remain.rows.map(r => r.slug).join(', ') || '(none)')
  console.log('remaining super admins:', supers.rows.map(r => r.email).join(', ') || '(none — /setup is open)')
  await client.end()
}

main().catch(e => { console.error('CLEANUP FAILED:', e.message); process.exit(1) })
