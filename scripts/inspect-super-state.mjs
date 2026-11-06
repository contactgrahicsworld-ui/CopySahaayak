// Inspect users + super admin references in production DB (read-only)
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/home/z/my-project/.env', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const url = get('DIRECT_URL') || get('DATABASE_URL')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = (sql, p) => client.query(sql, p).then(r => r.rows)

console.log('== ALL USERS ==')
const users = await q(`SELECT id, email, name, role, "shopId", "isActive", "createdAt" FROM csp."User" ORDER BY "createdAt"`)
for (const u of users) console.log(`- ${u.email} | ${u.role} | shop=${u.shopId || '-'} | active=${u.isActive} | id=${u.id}`)

const supers = users.filter(u => u.role === 'SUPER_ADMIN')
console.log('\n== SUPER ADMIN FK REFERENCES ==')
for (const s of supers) {
  const sessions = await q(`SELECT count(*)::int AS n FROM csp."Session" WHERE "userId"=$1`, [s.id])
  const audits = await q(`SELECT count(*)::int AS n FROM csp."AuditLog" WHERE "userId"=$1`, [s.id])
  const payVerified = await q(`SELECT count(*)::int AS n FROM csp."Payment" WHERE "verifiedByUserId"=$1`, [s.id])
  const subPayVerified = await q(`SELECT count(*)::int AS n FROM csp."SubscriptionPayment" WHERE "verifiedByUserId"=$1`, [s.id])
  const memberships = await q(`SELECT count(*)::int AS n FROM csp."ShopMember" WHERE "userId"=$1`, [s.id])
  console.log(`- ${s.email}: sessions=${sessions[0].n} auditLogs=${audits[0].n} paymentsVerified=${payVerified[0].n} subPaymentsVerified=${subPayVerified[0].n} memberships=${memberships[0].n}`)
}

console.log('\n== PLATFORM SETTINGS ==')
const settings = await q(`SELECT key, value FROM csp."PlatformSetting" ORDER BY key`)
for (const s of settings) console.log(`- ${s.key} = ${s.value === '' ? '(empty)' : s.value}`)

console.log('\n== SHOPS ==')
const shops = await q(`SELECT id, name, slug, "isActive" FROM csp."Shop" ORDER BY "createdAt"`)
for (const s of shops) console.log(`- ${s.name} (${s.slug}) active=${s.isActive}`)

console.log('\n== SUBSCRIPTION PAYMENTS (platform UPI flow) ==')
const subs = await q(`SELECT id, status, "amountPaise", "createdAt" FROM csp."SubscriptionPayment" ORDER BY "createdAt" DESC LIMIT 5`)
for (const s of subs) console.log(`- ${s.id.slice(0,10)} ${s.status} ${s.amountPaise} ${s.createdAt.toISOString()}`)

await client.end()
