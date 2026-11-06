// FK constraints + Supabase auth users + subpayment details (read-only)
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

console.log('== FK CONSTRAINTS referencing User ==')
const fks = await q(`
  SELECT tc.table_name, kcu.column_name, rc.delete_rule, rc.update_rule
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc ON tc.constraint_name = rc.constraint_name AND tc.table_schema='csp'
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name AND kcu.table_schema='csp'
  JOIN information_schema.table_constraints tco ON tco.constraint_name = rc.unique_constraint_name AND tco.table_schema='csp'
  WHERE tc.table_schema='csp' AND tco.table_name='User'
  ORDER BY tc.table_name`)
for (const f of fks) console.log(`- ${f.table_name}.${f.column_name} ON DELETE ${f.delete_rule}`)

console.log('\n== SubscriptionPayment detail ==')
const subs = await q(`SELECT sp.id, sp.status, sp."amountPaise", sp.utr, sp."createdAt", s.name AS shop
  FROM csp."SubscriptionPayment" sp LEFT JOIN csp."Shop" s ON s.id = sp."shopId" ORDER BY sp."createdAt" DESC LIMIT 5`)
for (const s of subs) console.log(`- ${s.id.slice(0,10)} | ${s.status} | ${s.amountPaise} | utr=${s.utr} | shop=${s.shop}`)

console.log('\n== Shop subscription state ==')
const shops = await q(`SELECT s.name, s.slug, p.code AS plan, sb.status, sb."expiresAt"
  FROM csp."Shop" s
  LEFT JOIN csp."Subscription" sb ON sb."shopId" = s.id
  LEFT JOIN csp."Plan" p ON p.id = sb."planId"`)
for (const s of shops) console.log(`- ${s.slug}: plan=${s.plan || '-'} status=${s.status || '-'} expires=${s.expiresAt?.toISOString() || '-'}`)

await client.end()

// Supabase auth users
const SUPA = get('SUPABASE_URL')
const KEY = get('SUPABASE_SERVICE_ROLE_KEY')
const res = await fetch(`${SUPA}/auth/v1/admin/users?perPage=50`, { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY } })
const data = await res.json()
console.log('\n== SUPABASE AUTH USERS ==')
for (const u of data.users || []) console.log(`- ${u.email} | id=${u.id} | created=${u.created_at}`)
