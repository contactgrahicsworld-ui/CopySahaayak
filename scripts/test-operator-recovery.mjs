// One-shot E2E test of the break-glass operator recovery endpoint (live).
// Steps: load env -> read shop-admin email from DB -> POST correct reset key
// -> expect 200 + 6-digit code -> delete the test OTP row (artifact cleanup).
// Prints masked output only. Uses at most ONE operator-otp rate-limit slot.
import fs from 'fs'

// .env for DATABASE_URL/DIRECT_URL; .env.vercel-pull for the deployed env (reset key)
for (const file of ['/home/z/my-project/.env', '/home/z/my-project/.env.vercel-pull']) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) {
      let v = m[2]
      if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1)
      process.env[m[1]] = v
    }
  }
}
const KEY = process.env.SUPER_SETUP_RESET_KEY
const BASE = 'https://copysahaayak.vercel.app'
if (!KEY || !KEY.startsWith('bk-')) { console.error('FAIL: reset key not parsed'); process.exit(1) }

const { PrismaClient } = await import('@prisma/client')
const db = new PrismaClient()

try {
  const admin = await db.user.findFirst({ where: { role: 'SHOP_ADMIN' }, select: { email: true } })
  if (!admin) { console.error('FAIL: no SHOP_ADMIN account to test with'); process.exit(1) }

  const res = await fetch(`${BASE}/api/auth/forgot/operator`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: admin.email, resetKey: KEY }),
  })
  const data = await res.json().catch(() => ({}))
  const code = String(data.code || '')
  const ok = res.status === 200 && /^\d{6}$/.test(code)

  console.log('operator-recovery success-path:', res.status, '| 6-digit code:', ok ? 'YES (masked)' : 'NO', '|', ok ? 'PASS' : `FAIL ${JSON.stringify(data).slice(0, 120)}`)

  if (ok) {
    // Cleanup: remove the single test OTP row created just now (my own artifact).
    const del = await db.passwordResetOtp.deleteMany({
      where: { email: admin.email, consumedAt: null, expiresAt: { gt: new Date() } },
    })
    console.log('cleanup: deleted test OTP rows:', del.count)
  }
} finally {
  await db.$disconnect()
}
