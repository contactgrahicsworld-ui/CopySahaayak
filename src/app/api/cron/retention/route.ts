// Daily data-retention job — keeps tenant data growth bounded so the platform
// stays fast no matter how many shops / orders / events accumulate.
//
// Prunes:
//   - AuditLog        older than 90 days  (compliance window for platform ops)
//   - PrintEvent      older than 90 days  (diagnostics window)
//   - Notification    older than 90 days  (in-app notices are short-lived)
//   - RateLimitEntry  windows already expired (limiter hygiene)
//   - PasswordResetOtp expired or consumed more than 24h ago
//   - CustomerSession not seen for 180 days (stale guest sessions)
//   - Session         expired/revoked more than 24h ago (daily-expiry policy
//                     hygiene — dead tokens never accumulate)
//   - AuthorityTransfer dead for 7 days (completed/cancelled/expired links)
//
// Auth: same pattern as plan-reminders — Vercel Cron `Authorization: Bearer
// $CRON_SECRET`, or manual with ?secret= (CRON_SECRET or APP_SECRET).
import { db } from '@/lib/db'
import { jsonOk, jsonError } from '@/lib/api'
import { timingSafeEqualStr } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET || process.env.APP_SECRET || ''
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('secret') || ''
  if (!secret || !timingSafeEqualStr(secret, provided)) {
    return jsonError(404, 'Not found')
  }

  const now = new Date()
  const d90 = new Date(now.getTime() - 90 * 86400000)
  const d180 = new Date(now.getTime() - 180 * 86400000)
  const d1 = new Date(now.getTime() - 86400000)
  const d7 = new Date(now.getTime() - 7 * 86400000)

  const [audit, events, notes, rl, otps, sessions, adminSessions, transfers] = await Promise.all([
    db.auditLog.deleteMany({ where: { createdAt: { lt: d90 } } }).catch(() => null),
    db.printEvent.deleteMany({ where: { createdAt: { lt: d90 } } }).catch(() => null),
    db.notification.deleteMany({ where: { createdAt: { lt: d90 } } }).catch(() => null),
    db.rateLimitEntry.deleteMany({ where: { windowExpiresAt: { lt: now } } }).catch(() => null),
    db.passwordResetOtp
      .deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { lt: d1 } }] } })
      .catch(() => null),
    db.customerSession.deleteMany({ where: { lastSeenAt: { lt: d180 } } }).catch(() => null),
    // Self-healing for the daily-expiry session policy: dead admin sessions are
    // swept a day after they stop being valid.
    db.session.deleteMany({ where: { OR: [{ expiresAt: { lt: d1 } }, { revokedAt: { lt: d1 } }] } }).catch(() => null),
    db.authorityTransfer
      .deleteMany({ where: { status: { not: 'PENDING' }, updatedAt: { lt: d7 } } })
      .catch(() => null),
  ])

  const count = (r: { count: number } | null) => (r ? r.count : -1)
  return jsonOk({
    pruned: {
      auditLog: count(audit),
      printEvents: count(events),
      notifications: count(notes),
      rateLimitEntries: count(rl),
      passwordResetOtps: count(otps),
      staleCustomerSessions: count(sessions),
      deadAdminSessions: count(adminSessions),
      deadTransfers: count(transfers),
    },
    ranAt: now.toISOString(),
  })
}
