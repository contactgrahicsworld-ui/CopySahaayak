// Remove the throwaway setup-verification account completely:
// app DB user (+ its audit logs, sessions cascade) + Supabase auth user.
// After this the platform returns to fresh first-run state (setup open).
import { readFileSync } from 'fs'
import pg from 'pg'

const EMAIL = 'setup.flow.v1@setup-verify.in'
const envText = readFileSync('/home/z/my-project/.env', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const client = new pg.Client({ connectionString: get('DIRECT_URL'), ssl: { rejectUnauthorized: false } })
await client.connect()

const u = (await client.query(`SELECT id, email, role FROM csp."User" WHERE lower(email)=$1`, [EMAIL])).rows[0]
if (!u) { console.log('not found in app DB (already gone)') } else {
  await client.query(`DELETE FROM csp."AuditLog" WHERE "userId"=$1`, [u.id])
  await client.query(`DELETE FROM csp."User" WHERE id=$1`, [u.id]) // sessions cascade
  console.log('deleted app DB user:', u.email, u.role)
}
await client.end()

const SUPA = get('SUPABASE_URL')
const KEY = get('SUPABASE_SERVICE_ROLE_KEY')
const res = await fetch(`${SUPA}/auth/v1/admin/users?perPage=100`, { headers: { Authorization: `Bearer ${KEY}`, apikey: KEY } })
const data = await res.json()
for (const au of data.users || []) {
  if (au.email === EMAIL) {
    const del = await fetch(`${SUPA}/auth/v1/admin/users/${au.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${KEY}`, apikey: KEY } })
    console.log('deleted supabase auth:', EMAIL, del.status)
  }
}
console.log('supabase remaining users:', (data.users || []).filter(x => x.email !== EMAIL).map(x => x.email).join(', '))
