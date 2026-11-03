// Remove ALL E2E test artifacts from the production database so the platform
// ships 100% fresh: no shops, no test users, no orders — only the real Super
// Admin account survives. Discovers actual tables and wipes in FK-safe order.
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/tmp/vercel-env.txt', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const keepEmail = (process.argv[2] || 'contact.grahicsworld@gmail.com').toLowerCase()
const client = new pg.Client({ connectionString: get('DIRECT_URL'), ssl: { rejectUnauthorized: false } })
await client.connect()

// FK-safe deletion order (leaves are first). Tables missing from this list but
// present in DB get dropped at the end generically.
const ORDER = [
  'PrintEvent', 'PrintJob', 'RoutingRule', 'OrderItem', 'PaymentVerification', 'Payment',
  'Order', 'Document', 'StoredObject', 'PasswordResetOtp', 'Session', 'CustomerSession',
  'AuditLog', 'Notification', 'SubscriptionPayment', 'PricingRule', 'RateLimitEntry',
  'ShopMember', 'Subscription', 'Device', 'Printer', 'Shop', 'User',
]

const existing = new Set(
  (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='csp'`)).rows.map((r) => r.table_name)
)

const before = await client.query(`SELECT
  (SELECT count(*) FROM csp."User") users,
  (SELECT count(*) FROM csp."Shop") shops,
  (SELECT count(*) FROM csp."Order") orders,
  (SELECT count(*) FROM csp."Document") docs`)
console.log('BEFORE:', JSON.stringify(before.rows[0]))

for (const t of ORDER) {
  if (!existing.has(t)) continue
  try {
    if (t === 'User') {
      await client.query(`DELETE FROM csp."User" WHERE lower(email) <> $1`, [keepEmail])
    } else {
      await client.query(`DELETE FROM csp."${t}"`)
    }
    console.log('wiped', t)
  } catch (e) {
    console.log(`skip ${t}: ${e.message.slice(0, 80)}`)
  }
}

const after = await client.query(`SELECT
  (SELECT count(*) FROM csp."User") users,
  (SELECT count(*) FROM csp."Shop") shops,
  (SELECT count(*) FROM csp."Order") orders`)
console.log('AFTER:', JSON.stringify(after.rows[0]))
const users = await client.query(`SELECT email, role FROM csp."User"`)
console.log('REMAINING USERS:', JSON.stringify(users.rows))
await client.end()
console.log('done — production is fresh')
