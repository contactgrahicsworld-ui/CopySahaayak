// Fresh-super-admin reset: remove ALL super admin accounts + test artifacts so the
// real platform owner can run first-time /setup manually with their own credentials.
// FK-safe: Session cascades, AuditLog/Payment/SubscriptionPayment refs auto-SET NULL.
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

await run('BEGIN')
try {
  // 1. Find all super admins
  const supers = await q(`SELECT id, email, "isActive" FROM csp."User" WHERE role='SUPER_ADMIN'`)
  console.log('super admins found:', supers.map(s => `${s.email}(${s.isActive ? 'active' : 'inactive'})`).join(', '))

  for (const s of supers) {
    // 2. Delete their audit logs (all test-era logs) before user delete
    const del = await q(`DELETE FROM csp."AuditLog" WHERE "userId"=$1 RETURNING id`, [s.id])
    console.log(`- ${s.email}: deleted ${del.length} audit logs`)
    // 3. Delete the user (sessions cascade, verifiedBy refs auto-SET NULL)
    await run(`DELETE FROM csp."User" WHERE id=$1`, [s.id])
    console.log(`- ${s.email}: user deleted`)
  }

  // 4. Remove test-era subscription payment (fake UTR) on mansa
  const fakeSubs = await q(`DELETE FROM csp."SubscriptionPayment" WHERE utr='987654321098' RETURNING id, "shopId"`)
  console.log('fake UTR subscription payments deleted:', fakeSubs.length)

  // 5. Reset every shop subscription to FREE (same shape /api/register creates)
  const free = await q(`SELECT id, "durationDays" FROM csp."Plan" WHERE code='FREE'`)
  if (free.length) {
    const planId = free[0].id
    const days = free[0].durationDays
    const reset = await q(`UPDATE csp."Subscription" sb SET "planId"=$1, status='ACTIVE', "startsAt"=now(), "expiresAt"=now() + ($2 || ' days')::interval, "updatedAt"=now() RETURNING sb."shopId"`, [planId, String(days)])
    console.log('subscriptions reset to FREE:', reset.length)
  }

  // 6. Verify: no super admins remain
  const after = await q(`SELECT count(*)::int AS n FROM csp."User" WHERE role='SUPER_ADMIN'`)
  console.log('super admins remaining:', after[0].n)

  await run('COMMIT')
  console.log('DB cleanup COMMITTED')
} catch (e) {
  await run('ROLLBACK')
  console.error('ROLLBACK — error:', e.message)
  process.exit(1)
}

// 7. Remaining users sanity check
const users = await q(`SELECT email, role FROM csp."User" ORDER BY role`)
console.log('\nremaining users:')
for (const u of users) console.log(`- ${u.email} (${u.role})`)

await client.end()

// 8. Supabase auth cleanup: delete super-admin + test emails (keeps real owners)
const SUPA = get('SUPABASE_URL')
const KEY = get('SUPABASE_SERVICE_ROLE_KEY')
const KEEP = ['cscrjn85@gmail.com', 'contact.grahicsworld@gmail.com']
const isTest = (email) =>
  KEEP.includes(email) === false &&
  (/@testshop-test\.in$/.test(email) ||
   /@verify-test\.com$/.test(email) ||
   /@copysahaayak-test\.in$/.test(email) ||
   /@setup-verify\./.test(email) ||
   email.endsWith('@copysahaayak.app') ||
   /^selfreg\.test@/.test(email) ||
   /^regtest\d*@/.test(email) ||
   /^owner\.autoext\./.test(email))

let page = 1, deleted = 0, kept = 0, scanned = 0
while (true) {
  const res = await fetch(`${SUPA}/auth/v1/admin/users?perPage=100&page=${page}`, {
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
  })
  if (!res.ok) { console.error('supabase list failed:', res.status); break }
  const data = await res.json()
  const users = data.users || []
  if (users.length === 0) break
  for (const u of users) {
    scanned++
    if (isTest(u.email)) {
      const del = await fetch(`${SUPA}/auth/v1/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
      })
      if (del.ok || del.status === 404) { deleted++; console.log('deleted supabase auth:', u.email) }
      else console.error('FAILED delete:', u.email, del.status)
    } else {
      kept++
      console.log('kept supabase auth:', u.email)
    }
  }
  if (data.users && data.users.length < 100) break
  page++
}
console.log(`\nSupabase auth: scanned=${scanned} deleted=${deleted} kept=${kept}`)
