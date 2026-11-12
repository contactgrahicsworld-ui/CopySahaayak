// Read-only prod check: what does every shop's subscription clock say RIGHT NOW?
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/tmp/vercel-env-cli.txt', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const url = get('DIRECT_URL') || get('DATABASE_URL')
if (!url) { console.error('No DIRECT_URL found'); process.exit(1) }
try { const u = new URL(url); console.log('DB host:', u.hostname, '| schema:', (url.match(/schema=([^&]+)/) || [])[1] || 'default') } catch { console.log('DB url non-standard, continuing') }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = async (sql, p) => (await client.query(sql, p)).rows

const NOW = new Date()
console.log('SERVER UTC NOW :', NOW.toISOString())
console.log('SERVER IST NOW :', NOW.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))
console.log('')

const subs = await q(`
  SELECT s.id, sh.name AS shop, sh.slug, sp.name AS plan, sp.code, sp."durationDays",
         s.status, s."startsAt", s."expiresAt"
  FROM csp."Subscription" s
  JOIN csp."Shop" sh ON sh.id = s."shopId"
  JOIN csp."Plan" sp ON sp.id = s."planId"
  ORDER BY sh."createdAt"`)
console.log('SUBSCRIPTIONS (live):')
for (const r of subs) {
  let left = ''
  if (r.expiresAt) {
    const ms = new Date(r.expiresAt) - NOW
    const d = Math.floor(Math.max(0, ms) / 86400000)
    const h = Math.floor((Math.max(0, ms) % 86400000) / 3600000)
    const m = Math.floor((Math.max(0, ms) % 3600000) / 60000)
    left = ms > 0 ? `${d}d ${h}h ${m}m left` : `EXPIRED ${Math.floor(-ms / 86400000)}d ago`
  }
  const ist = r.expiresAt ? new Date(r.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-'
  console.log(` - ${r.shop} [${r.slug}] plan=${r.plan}(${r.code}) status=${r.status} expires=${ist} IST => ${left}`)
}
console.log('')

// Trial plan definition check
const plans = await q(`SELECT code, name, "durationDays", "pricePaise", "isActive" FROM csp."Plan" ORDER BY "sortOrder"`)
console.log('PLANS:', plans.map(p => `${p.code}:${p.name}:${p.durationDays}d:Rs${p.pricePaise / 100}:${p.isActive ? 'on' : 'off'}`).join(' | '))

await client.end()
