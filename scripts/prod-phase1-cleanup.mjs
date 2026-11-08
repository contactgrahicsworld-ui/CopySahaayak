// Phase-1 production cleanup (direct DB, FK-safe, single transaction):
//   1. DELETE every SUPER_ADMIN user (old credentials gone forever) + their audit logs
//   2. DELETE all @testshop-test.in / @testsuper-test.in test users (E2E leftovers)
//   3. DELETE fake E2E subscription payments (UTR SUBE2E*)
//   4. mansa fake STARTER-2036 subscription -> FREE with NO expiry (timer kill)
//   5. ALL FREE-plan subscriptions -> expiresAt = NULL (2036 timer gone on live dashboards)
//   6. DELETE all admin sessions (fresh start; everyone re-logs in)
// Print before/after state for the audit trail.
import { readFileSync } from 'fs'
import pg from 'pg'

const DBPASS = readFileSync('/tmp/my-project/.dbpass', 'utf8').trim()
const client = new pg.Client({
  connectionString: 'postgresql://postgres.oqowxmrzaxnundghsrct:' + encodeURIComponent(DBPASS) + '@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
})
await client.connect()
const q = (sql, p) => client.query(sql, p).then((r) => r.rows)
const run = (sql, p) => client.query(sql, p)

console.log('=== BEFORE ===')
const beforeSupers = await q(`SELECT email, "isActive" FROM csp."User" WHERE role='SUPER_ADMIN'`)
const beforeUsers = await q(`SELECT count(*)::int n FROM csp."User"`)
const beforeSessions = await q(`SELECT count(*)::int n FROM csp."Session"`)
console.log('supers:', JSON.stringify(beforeSupers))
console.log('users:', beforeUsers[0].n, '| sessions:', beforeSessions[0].n)

await run('BEGIN')
try {
  // 1. Super admin audit logs first (FK), then the users (sessions/verified-refs auto)
  const saLogs = await q(`DELETE FROM csp."AuditLog" WHERE "userId" IN (SELECT id FROM csp."User" WHERE role='SUPER_ADMIN') RETURNING id`)
  console.log('super audit logs deleted:', saLogs.length)
  const supers = await q(`DELETE FROM csp."User" WHERE role='SUPER_ADMIN' RETURNING email`)
  console.log('SUPER ADMINS DELETED:', supers.map((s) => s.email).join(', ') || '(none)')

  // 2. Test users (E2E leftovers, no shops attached)
  const tests = await q(`DELETE FROM csp."User" WHERE email LIKE '%@testshop-test.in' OR email LIKE '%@testsuper-test.in' RETURNING email`)
  console.log('test users deleted:', tests.map((t) => t.email).join(', ') || '(none)')

  // 3. Fake E2E subscription payments
  const fake = await q(`DELETE FROM csp."SubscriptionPayment" WHERE utr LIKE 'SUBE2E%' RETURNING utr`)
  console.log('fake subscription payments deleted:', fake.map((f) => f.utr).join(', ') || '(none)')

  // 4. mansa fake STARTER-2036 -> FREE, no expiry
  const mansa = await q(`UPDATE csp."Subscription" sb SET "planId"=(SELECT id FROM csp."Plan" WHERE code='FREE'), status='ACTIVE', "startsAt"=now(), "expiresAt"=NULL, "updatedAt"=now() FROM csp."Shop" s WHERE s.id=sb."shopId" AND s.slug='mansa' RETURNING s.slug`)
  console.log('mansa subscription reset to FREE/no-expiry:', mansa.map((m) => m.slug).join(', ') || '(none)')

  // 5. Every remaining FREE subscription: kill the 10-year clock (expiresAt NULL)
  const freed = await q(`UPDATE csp."Subscription" sb SET "expiresAt"=NULL, "updatedAt"=now() FROM csp."Plan" p WHERE p.id=sb."planId" AND p.code='FREE' AND sb."expiresAt" IS NOT NULL RETURNING sb."shopId"`)
  console.log('FREE subscriptions set to lifetime (no expiry):', freed.length)

  // 6. All admin sessions gone — everyone signs in again cleanly
  const sess = await q(`DELETE FROM csp."Session" RETURNING id`)
  console.log('sessions deleted:', sess.length)

  await run('COMMIT')
  console.log('=== COMMITTED ===')
} catch (e) {
  await run('ROLLBACK')
  console.error('ROLLBACK — error:', e.message)
  process.exit(1)
}

console.log('=== AFTER ===')
const afterSupers = await q(`SELECT count(*)::int n FROM csp."User" WHERE role='SUPER_ADMIN'`)
const afterUsers = await q(`SELECT count(*)::int n FROM csp."User"`)
const afterSessions = await q(`SELECT count(*)::int n FROM csp."Session"`)
const subs = await q(`SELECT s.slug, p.code plan, sb."expiresAt" FROM csp."Subscription" sb JOIN csp."Shop" s ON s.id=sb."shopId" JOIN csp."Plan" p ON p.id=sb."planId"`)
const users = await q(`SELECT email, role FROM csp."User" ORDER BY role, email`)
console.log('supers:', afterSupers[0].n, '| users:', afterUsers[0].n, '| sessions:', afterSessions[0].n)
console.log('subscriptions:')
for (const s of subs) console.log(' -', s.slug, '|', s.plan, '| till:', s.expiresAt ? new Date(s.expiresAt).toISOString().slice(0, 10) : 'NO EXPIRY (lifetime)')
console.log('remaining users:')
for (const u of users) console.log(' -', u.email, '(', u.role, ')')
await client.end()
