// Rotate credentials: fresh strong passwords for SUPER_ADMIN + SHOP_ADMIN,
// revoke every existing session, keep Supabase mirror users in sync.
// Prints the new credentials once (platform owner handover).
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { readFileSync } from 'fs'

const env = {}
for (const line of readFileSync('/home/z/my-project/.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const db = new PrismaClient()
const genPw = (tag) => `Cs-${tag}-${crypto.randomBytes(9).toString('base64url')}`

try {
  const sbUrl = (env.SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '')
  const sk = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  console.log('mirror env loaded:', Boolean(sbUrl && sk))

  async function rotate(email, tag) {
    const user = await db.user.findUnique({ where: { email } })
    if (!user) { console.log('NOT FOUND:', email); return null }
    const pw = genPw(tag)
    const hash = await bcrypt.hash(pw, 12)
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hash } })
    const revoked = await db.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
    // Supabase mirror sync (best effort)
    let mirror = 'no-mirror'
    if (sbUrl && sk) {
      const lst = await fetch(`${sbUrl}/auth/v1/admin/users?page=1&per_page=50&email=${encodeURIComponent(email)}`, { headers: { apikey: sk, Authorization: `Bearer ${sk}` } })
      const lj = await lst.json().catch(() => null)
      const su = lj?.users?.find((u) => (u.email || '').toLowerCase() === email)
      if (su) {
        const upd = await fetch(`${sbUrl}/auth/v1/admin/users/${su.id}`, { method: 'PUT', headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: crypto.randomBytes(24).toString('base64url') }) })
        mirror = upd.status === 200 ? 'synced' : `HTTP ${upd.status}`
      }
    }
    await db.auditLog.create({ data: { shopId: user.shopId, userId: user.id, actorType: 'SYSTEM', action: 'CREDENTIALS_ROTATED', metaJson: JSON.stringify({ email, by: 'platform-owner-request', sessionsRevoked: revoked.count }) } })
    console.log(`${user.role} | ${email} | sessions revoked: ${revoked.count} | supabase mirror: ${mirror}`)
    return pw
  }

  const superPw = await rotate('vedpackagingindustries@gmail.com', 'Super')
  const shopPw = await rotate('contact.grahicsworld@gmail.com', 'Mansa')
  console.log('---NEW CREDENTIALS---')
  console.log(`SUPER_ADMIN ${superPw}`)
  console.log(`SHOP_ADMIN ${shopPw}`)
} finally { await db.$disconnect() }
