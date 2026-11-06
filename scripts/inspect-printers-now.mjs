// Inspect device + printer state for the mansa shop (read-only)
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
const q = (sql) => client.query(sql).then(r => r.rows)

console.log('DEVICES (mansa):', JSON.stringify(await q(`SELECT id, name, "machineName", status, "lastSeenAt" FROM csp."Device" WHERE "shopId"='cmw0kht360004l907yw48iavf' ORDER BY "createdAt"`), null, 1))
console.log('PRINTERS (mansa):', JSON.stringify(await q(`SELECT id, "windowsName", "displayName", status, "deviceId", "lastSeenAt" FROM csp."Printer" WHERE "shopId"='cmw0kht360004l907yw48iavf' ORDER BY "createdAt"`), null, 1))
console.log('AUDIT_TRAIL (recent device/printer ops):', JSON.stringify(await q(`SELECT action, meta, "createdAt" FROM csp."AuditLog" WHERE "shopId"='cmw0kht360004l907yw48iavf' AND (action LIKE 'DEVICE%' OR action LIKE 'PRINTER%') ORDER BY "createdAt" DESC LIMIT 12`), null, 1))
await client.end()
