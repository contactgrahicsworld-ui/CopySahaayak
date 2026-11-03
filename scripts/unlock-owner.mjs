// Emergency unlock: set a temp password for the shop owner (DB + Supabase mirror),
// then trigger one fresh OTP so we can test whether Supabase's built-in mailer delivers.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const env = {}
for (const line of (() => { try { return require('fs').readFileSync('/home/z/my-project/.env', 'utf8') } catch { return '' } })().split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2]
}
const db = new PrismaClient()

const EMAIL = 'contact.grahicsworld@gmail.com'
const tempPassword = 'Cs-' + crypto.randomBytes(6).toString('base64url') // e.g. Cs-Ab3xK9_q

try {
  const user = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true, email: true, isActive: true, role: true, shop: { select: { slug: true, name: true } } } })
  if (!user) { console.log('USER NOT FOUND:', EMAIL); process.exit(1) }
  console.log('user:', user.email, '| role:', user.role, '| active:', user.isActive, '| shop:', user.shop?.slug, `(${user.shop?.name})`)
  if (!user.isActive) { console.log('!! user inactive — activating'); await db.user.update({ where: { id: user.id }, data: { isActive: true } }) }

  const hash = await bcrypt.hash(tempPassword, 12)
  await db.user.update({ where: { id: user.id }, data: { passwordHash: hash } })
  console.log('DB password updated.')

  // Mirror to Supabase auth admin (keeps future OTP resets consistent)
  const SB = env.SUPABASE_URL?.replace(/\/+$/, '')
  const SK = env.SUPABASE_SERVICE_ROLE_KEY
  if (SB && SK) {
    const lst = await fetch(`${SB}/auth/v1/admin/users?page=1&per_page=50&email=${encodeURIComponent(EMAIL)}`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` } })
    const lj = await lst.json().catch(() => null)
    const su = lj?.users?.find((u) => (u.email || '').toLowerCase() === EMAIL)
    if (su) {
      const upd = await fetch(`${SB}/auth/v1/admin/users/${su.id}`, { method: 'PUT', headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: tempPassword }) })
      console.log('Supabase mirror password updated:', upd.status === 200 ? 'OK' : `HTTP ${upd.status}`)
    } else console.log('Supabase mirror user not found (skip)')
  }

  // Trigger one fresh OTP via the app's own forgot endpoint (public prod URL)
  const app = 'https://copysahaayak.vercel.app'
  const res = await fetch(`${app}/api/auth/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL }) })
  const body = await res.json().catch(() => null)
  console.log('fresh OTP trigger:', res.status, JSON.stringify(body))

  console.log('TEMP_PASSWORD=' + tempPassword)
} finally { await db.$disconnect() }
