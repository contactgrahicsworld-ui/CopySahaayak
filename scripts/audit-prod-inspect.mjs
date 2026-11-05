// Inspect audit test artifacts in production DB (read-only)
import { readFileSync } from 'fs'
import pg from 'pg'

const envText = readFileSync('/home/z/my-project/.env', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const url = get('DIRECT_URL')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = (sql, p) => client.query(sql, p).then(r => r.rows)

const mansa = await q(`SELECT id, name FROM csp."Shop" WHERE slug='mansa'`)
const MANS = mansa[0]?.id
console.log('mansa shopId:', MANS)

console.log('\n== ORDERS (mansa, last 24h) ==')
const ords = await q(`SELECT "orderNumber", status, "totalPaise", "customerName", "createdAt" FROM csp."Order" WHERE "shopId"=$1 AND "createdAt" > now() - interval '24 hours' ORDER BY "createdAt" DESC`, [MANS])
for (const o of ords) console.log('-', o.orderNumber, o.status, o.totalPaise, o.customerName, o.createdAt.toISOString())

console.log('\n== DOCUMENTS (mansa) ==')
const docs = await q(`SELECT id, "originalName", status, "createdAt" FROM csp."Document" WHERE "shopId"=$1 ORDER BY "createdAt" DESC LIMIT 10`, [MANS])
for (const d of docs) console.log('-', d.id.slice(0,10), d.originalName, d.status, d.createdAt.toISOString())

console.log('\n== DEVICES (mansa) ==')
const devs = await q(`SELECT id, name, "machineName", status FROM csp."Device" WHERE "shopId"=$1`, [MANS])
for (const d of devs) console.log('-', d.id.slice(0,10), d.name, d.machineName, d.status)

console.log('\n== PRINTERS (mansa) ==')
const prs = await q(`SELECT id, "windowsName", "colorMode", status FROM csp."Printer" WHERE "shopId"=$1`, [MANS])
for (const p of prs) console.log('-', p.id.slice(0,10), p.windowsName, p.colorMode, p.status)

console.log('\n== SUBSCRIPTION PAYMENTS (mansa) ==')
const sps = await q(`SELECT id, utr, status, "createdAt" FROM csp."SubscriptionPayment" WHERE "shopId"=$1 ORDER BY "createdAt" DESC LIMIT 5`, [MANS])
for (const s of sps) console.log('-', s.id.slice(0,10), s.utr, s.status, s.createdAt.toISOString())

console.log('\n== AUDIT (mansa, last 24h, count by action) ==')
const aud = await q(`SELECT action, count(*)::int n FROM csp."AuditLog" WHERE "shopId"=$1 AND "createdAt" > now() - interval '24 hours' GROUP BY action ORDER BY n DESC`, [MANS])
for (const a of aud) console.log('-', a.action, a.n)

console.log('\n== NOTIFICATIONS (mansa, last 24h) ==')
const nots = await q(`SELECT title FROM csp."Notification" WHERE "shopId"=$1 AND "createdAt" > now() - interval '24 hours' ORDER BY "createdAt" DESC LIMIT 12`, [MANS])
for (const n of nots) console.log('-', n.title)

console.log('\n== ALL SHOPS / USERS sanity ==')
const shops = await q(`SELECT slug, name, "isActive" FROM csp."Shop" ORDER BY "createdAt"`)
for (const s of shops) console.log('-', s.slug, s.name, s.isActive)
const users = await q(`SELECT email, role, "isActive" FROM csp."User" ORDER BY "createdAt"`)
for (const u of users) console.log('-', u.email, u.role, u.isActive)

await client.end()
console.log('\nDONE (read-only)')
