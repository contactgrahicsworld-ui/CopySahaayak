// Delete mansa's 4 test devices + 3 test printers + routing rules (FK-safe).
// sharma's real connector (DESKTOP-TC307UR) is NOT touched.
import { readFileSync } from 'fs'
import pg from 'pg'
const envText = readFileSync('/home/z/my-project/.env', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const c = new pg.Client({ connectionString: get('DIRECT_URL'), ssl: { rejectUnauthorized: false } })
await c.connect()
const mansa = (await c.query(`SELECT id FROM csp."Shop" WHERE slug='mansa'`)).rows[0]

const rr = await c.query(`DELETE FROM csp."RoutingRule" WHERE "shopId"=$1 RETURNING id`, [mansa.id])
console.log('routing rules deleted:', rr.rows.length)
const pj = await c.query(`UPDATE csp."PrintJob" SET "printerId"=NULL, "deviceId"=NULL WHERE "shopId"=$1 RETURNING id`, [mansa.id])
console.log('printjobs detached:', pj.rows.length)
const pr = await c.query(`DELETE FROM csp."Printer" WHERE "shopId"=$1 RETURNING "windowsName"`, [mansa.id])
console.log('printers deleted:', pr.rows.map(r => r.windowsName).join(', '))
const dv = await c.query(`DELETE FROM csp."Device" WHERE "shopId"=$1 RETURNING name, "machineName"`, [mansa.id])
console.log('devices deleted:', dv.rows.map(r => `${r.name} (${r.machineName || '-'})`).join(', '))

const left = await c.query(`SELECT d.name, d.status, s.slug FROM csp."Device" d JOIN csp."Shop" s ON s.id=d."shopId"`)
for (const d of left.rows) console.log('remaining device:', d.slug, d.name, d.status)
const leftp = await c.query(`SELECT count(*)::int AS n, s.slug FROM csp."Printer" p JOIN csp."Shop" s ON s.id=p."shopId" GROUP BY s.slug`)
for (const p of leftp.rows) console.log('remaining printers:', p.slug, p.n)
await c.end()
