// Debug: check recent audit + rate-limit + OTP rows for the email-delivery issue
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const j = (s) => { try { return JSON.parse(s) } catch { return s } }
try {
  const audits = await db.auditLog.findMany({
    where: { OR: [{ action: { contains: 'LOGIN' } }, { action: { contains: 'RESET' } }, { action: { contains: 'OTP' } }] },
    orderBy: { createdAt: 'desc' }, take: 15,
    select: { createdAt: true, action: true, actorType: true, metaJson: true, ip: true },
  })
  console.log('=== AuditLog (login/reset/otp) ===')
  for (const a of audits) console.log(a.createdAt.toISOString(), a.action, a.actorType, a.ip || '-', j(a.metaJson) || '')

  const rl = await db.rateLimitEntry.findMany({
    where: { key: { contains: 'forgot' } },
    orderBy: { windowExpiresAt: 'desc' }, take: 10,
  })
  console.log('\n=== RateLimitEntry (forgot bucket) ===')
  for (const r of rl) console.log(r.key, 'count=', r.count, 'windowExpiresAt=', r.windowExpiresAt.toISOString(), new Date() < r.windowExpiresAt ? '(ACTIVE)' : '(expired)')

  const otps = await db.passwordResetOtp.findMany({ orderBy: { createdAt: 'desc' }, take: 8 })
  console.log('\n=== PasswordResetOtp (app-issued, resend path only) ===')
  for (const o of otps) console.log(o.createdAt.toISOString(), o.email, 'expires', o.expiresAt.toISOString(), 'consumed', !!o.consumedAt, 'attempts', o.attempts)
} finally { await db.$disconnect() }
