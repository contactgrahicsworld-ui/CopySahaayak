// Sweep Supabase auth: delete every user except the two real shop owners.
// Repeats until no deletable users remain (handles pagination shifts).
import { readFileSync } from 'fs'
const envText = readFileSync('/home/z/my-project/.env', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const SUPA = get('SUPABASE_URL')
const KEY = get('SUPABASE_SERVICE_ROLE_KEY')
const KEEP = new Set(['cscrjn85@gmail.com', 'contact.grahicsworld@gmail.com'])

let totalDeleted = 0, rounds = 0
while (rounds < 10) {
  rounds++
  const res = await fetch(`${SUPA}/auth/v1/admin/users?perPage=100`, {
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
  })
  const data = await res.json()
  const users = data.users || []
  const deletable = users.filter(u => !KEEP.has(u.email))
  if (users.length === 0 || deletable.length === 0) {
    console.log(`round ${rounds}: ${users.length} users, 0 deletable — done`)
    break
  }
  console.log(`round ${rounds}: ${users.length} users, deleting ${deletable.length}`)
  for (const u of deletable) {
    const del = await fetch(`${SUPA}/auth/v1/admin/users/${u.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${KEY}`, apikey: KEY },
    })
    if (del.ok || del.status === 404) { totalDeleted++; console.log(' deleted:', u.email) }
    else console.error(' FAILED:', u.email, del.status)
  }
}
console.log('total deleted:', totalDeleted)
