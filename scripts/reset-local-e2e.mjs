// Local E2E re-run reset: removes the dynamic Super Admin + E2E test data so
// the next run exercises the FRESH /setup path again, and clears rate-limit
// buckets. Uses DIRECT_URL from .env (local sandbox use only).
import { readFileSync } from 'fs'
import pg from 'pg'

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1] || ''
const client = new pg.Client({ connectionString: get('DIRECT_URL'), ssl: { rejectUnauthorized: false } })
await client.connect()

const before = await client.query(`SELECT
  (SELECT count(*) FROM csp."User") users,
  (SELECT count(*) FROM csp."Shop") shops,
  (SELECT count(*) FROM csp."Order") orders`)
console.log('BEFORE:', JSON.stringify(before.rows[0]))

// FK-safe leaf-first wipe of dynamic test data; plans/settings survive.
for (const t of ['PrintEvent', 'PrintJob', 'RoutingRule', 'OrderItem', 'PaymentVerification', 'Payment', 'Order', 'Document', 'StoredObject', 'PasswordResetOtp', 'Session', 'CustomerSession', 'AuditLog', 'Notification', 'SubscriptionPayment', 'PricingRule', 'RateLimitEntry', 'ShopMember', 'Subscription', 'Device', 'Printer']) {
  await client.query(`DELETE FROM csp."${t}"`)
}
await client.query(`DELETE FROM csp."Shop"`)
await client.query(`DELETE FROM csp."User"`)
await client.query(`DELETE FROM csp."PlatformSetting" WHERE key NOT IN ('platform_name','super_admin_payee_name','support_phone','order_prefix')`)

const after = await client.query(`SELECT
  (SELECT count(*) FROM csp."User") users,
  (SELECT count(*) FROM csp."Shop") shops`)
console.log('AFTER:', JSON.stringify(after.rows[0]), '— /setup is fresh again')
await client.end()
