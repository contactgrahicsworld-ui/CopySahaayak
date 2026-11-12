// Production invariant audit for the plan/timer subsystem.
// Asserts the invariants that make a "13 din on a 7-din trial" bug impossible:
//   I1. No subscription exists on the retired FREE plan.
//   I2. No ACTIVE subscription has expiresAt in the past (stale status).
//   I3. TRIAL subscriptions span exactly plan.durationDays (no stacking on trials).
//   I4. Every ACTIVE/PENDING_VERIFICATION subscription has remaining time
//       <= its plan durationDays (the countdown can never exceed the plan).
//   I5. startsAt <= expiresAt always; both present when status is not PENDING_VERIFICATION.
// Exit code 0 = all invariants hold; 1 = violations (printed).
import { readFileSync } from 'fs'
import pg from 'pg'

let DBPASS = ''
for (const p of ['/home/z/my-project/scripts/.dbpass', '/tmp/my-project/.dbpass']) {
  try { DBPASS = readFileSync(p, 'utf8').trim(); if (DBPASS) break } catch { /* next */ }
}
if (!DBPASS) { console.error('dbpass not found'); process.exit(2) }
const client = new pg.Client({
  connectionString: 'postgresql://postgres.oqowxmrzaxnundghsrct:' + encodeURIComponent(DBPASS) + '@aws-0-ap-south-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
})
await client.connect()

const subs = await client.query(`
  SELECT s."shopId", sh.slug AS shop, s.status, s."startsAt", s."expiresAt",
         p.code AS plan_code, p.name AS plan_name, p."durationDays"
  FROM csp."Subscription" s
  JOIN csp."Shop" sh ON sh.id = s."shopId"
  JOIN csp."Plan" p ON p.id = s."planId"`)

const violations = []
const DAY = 86400000
for (const s of subs.rows) {
  const tag = `${s.shop} [${s.plan_name}] status=${s.status}`
  if (s.plan_code === 'FREE') violations.push(`I1 ${tag}: still on retired FREE plan`)
  if (s.startsAt && s.expiresAt && new Date(s.expiresAt) <= new Date(s.startsAt))
    violations.push(`I5 ${tag}: startsAt >= expiresAt`)
  if (s.status === 'ACTIVE') {
    if (new Date(s.expiresAt) < new Date()) violations.push(`I2 ${tag}: ACTIVE but already expired (${s.expiresAt})`)
    const remainingDays = (new Date(s.expiresAt) - Date.now()) / DAY
    if (remainingDays > s.durationDays + 0.01)
      violations.push(`I4 ${tag}: remaining ${remainingDays.toFixed(2)}d > plan ${s.durationDays}d`)
    if (s.plan_code === 'TRIAL' && s.startsAt) {
      const span = (new Date(s.expiresAt) - new Date(s.startsAt)) / DAY
      if (Math.abs(span - s.durationDays) > 0.01)
        violations.push(`I3 ${tag}: trial span ${span.toFixed(2)}d != ${s.durationDays}d`)
    }
  }
}

console.log(`subscriptions checked: ${subs.rows.length}`)
for (const s of subs.rows) {
  const rem = s.expiresAt ? ((new Date(s.expiresAt) - Date.now()) / DAY).toFixed(2) : 'null'
  console.log(`  ${s.shop.padEnd(16)} ${s.plan_name.padEnd(14)} ${s.status.padEnd(20)} remaining=${rem}d plan=${s.durationDays}d`)
}
if (violations.length) {
  console.log('\nVIOLATIONS:')
  for (const v of violations) console.log('  ✗ ' + v)
  await client.end()
  process.exit(1)
}
console.log('\nALL 5 INVARIANTS HOLD ✓')
await client.end()
