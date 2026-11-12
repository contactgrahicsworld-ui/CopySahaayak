// Remove ONLY obvious test-leftover mirror users from Supabase auth.
// Real-user emails are preserved (owner + shop customers).
const fs = require('fs')
const env = fs.readFileSync('/tmp/vercel-env-cli.txt', 'utf8')
function ev(n) { const m = env.match(new RegExp('^' + n + '="?(.*?)"?$', 'm')); return m ? m[1].trim() : '' }
const SB_URL = ev('SUPABASE_URL').replace(/\/+$/, '')
const SB = ev('SUPABASE_SERVICE_ROLE_KEY')

const TEST_PATTERNS = [
  /^cpsuper[0-9a-z]+@/,           // mail.tm temp super inboxes
  /^simpletest\d*@/,              // simpletest@check.local
  /^timer(t|check)?\d*@/,         // timer/timercheck @test.local
  /^super@copysahaayak\.local$/,
  /^owner\.[ab]\.[0-9a-z]+@testshop-test\.in$/,
  /^e2e-isolation-test@/,
  /^dgtest-[0-9a-f]+@/,
]
const KEEP = [
  'manish.mukherjee0184@gmail.com',
  'ipgroup2002@gmail.com',
  'vedpackagingindustries@gmail.com',
  'contact.grahicsworld@gmail.com',
  'cscrjn85@gmail.com',
]

;(async () => {
  const victims = []
  for (let p = 1; p <= 5; p++) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users?per_page=200&page=${p}`, { headers: { apikey: SB, Authorization: `Bearer ${SB}` } })
    const j = await r.json()
    const us = j.users || []
    for (const u of us) {
      const email = (u.email || '').toLowerCase()
      if (KEEP.includes(email)) continue
      if (TEST_PATTERNS.some((re) => re.test(email))) victims.push({ id: u.id, email })
    }
    if (us.length < 200) break
  }
  console.log(`Deleting ${victims.length} test mirror users...`)
  for (const v of victims) {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users/${v.id}`, { method: 'DELETE', headers: { apikey: SB, Authorization: `Bearer ${SB}` } })
    console.log(`${r.status === 200 ? 'DELETED' : 'FAILED(' + r.status + ')'}: ${v.email}`)
  }
})()
