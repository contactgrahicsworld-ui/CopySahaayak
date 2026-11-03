// Daily plan-expiry reminder job (Vercel Cron or manual with secret).
// For every active subscription expiring within 7 days it records an in-app
// notification for the shop owner and attempts an email (only when a real
// transport is configured). Reminder days: 7, 3, 1 and 0 — one per day max
// (deduped by a same-day Notification row with the run tag).
//
// Channels honesty: without an SMS/WhatsApp Business provider only in-app
// notification + (optional) email are possible — nothing is silently faked;
// the response reports per-channel status so operators see the truth.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Manual runs
// may pass ?secret= (CRON_SECRET or APP_SECRET).
import { db } from '@/lib/db'
import { jsonOk, jsonError } from '@/lib/api'
import { sendMail, mailTransport } from '@/lib/mailer'

export const dynamic = 'force-dynamic'

const REMINDER_DAYS = [7, 3, 1, 0]

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET || process.env.APP_SECRET || ''
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('secret') || ''
  if (!secret || provided.length !== secret.length || provided !== secret) {
    return jsonError(404, 'Not found')
  }

  const now = new Date()
  const horizon = new Date(now.getTime() + 7 * 86400000)
  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)

  const subs = await db.subscription.findMany({
    where: { status: 'ACTIVE', expiresAt: { gte: now, lte: horizon } },
    include: {
      plan: { select: { name: true } },
      shop: {
        select: {
          id: true, name: true, whatsappNumber: true, isActive: true,
          members: { take: 1, select: { user: { select: { email: true } } } },
        },
      },
    },
  })

  const results: Array<{ shop: string; plan: string; daysLeft: number; inApp: boolean; email: string }> = []

  for (const sub of subs) {
    if (!sub.shop.isActive) continue
    const ownerEmail = sub.shop.members[0]?.user.email
    const daysLeft = Math.ceil((new Date(sub.expiresAt as Date).getTime() - now.getTime()) / 86400000)
    if (!REMINDER_DAYS.includes(Math.max(0, daysLeft))) continue

    const tag = `plan-expiry-${daysLeft}d`
    const dupe = await db.notification.findFirst({
      where: { shopId: sub.shopId, audience: 'SHOP', title: { contains: tag }, createdAt: { gte: startOfDay } },
    })
    if (dupe) {
      results.push({ shop: sub.shop.name, plan: sub.plan.name, daysLeft, inApp: true, email: 'already-notified-today' })
      continue
    }

    const end = new Date(sub.expiresAt as Date).toLocaleDateString('en-IN')
    await db.notification.create({
      data: {
        shopId: sub.shopId,
        audience: 'SHOP',
        title: `${tag}: ${sub.plan.name} plan ends in ${Math.max(0, daysLeft)} day(s)`,
        body: `Your ${sub.plan.name} plan ends on ${end}. Renew from Settings → Subscription to keep receiving orders.`,
      },
    })

    let emailStatus = 'no-transport'
    if (mailTransport === 'resend') {
      if (!ownerEmail) {
        emailStatus = 'skipped-no-owner-email'
      } else {
        try {
          await sendMail({
            to: ownerEmail,
            subject: `${sub.shop.name}: ${sub.plan.name} plan ends in ${Math.max(0, daysLeft)} day(s)`,
            text: `Your ${sub.plan.name} plan ends on ${end}. Renew from your dashboard: Settings → Subscription → Renew / upgrade.`,
            html: `<p>Your <strong>${sub.plan.name}</strong> plan ends on <strong>${end}</strong>.</p><p>Renew from your dashboard: Settings → Subscription → Renew / upgrade, to keep receiving online orders.</p>`,
          })
          emailStatus = 'sent'
        } catch (err) {
          emailStatus = `failed: ${err instanceof Error ? err.message.slice(0, 120) : 'unknown'}`
        }
      }
    } else if (mailTransport === 'mock') {
      emailStatus = 'mock-captured'
    }

    results.push({ shop: sub.shop.name, plan: sub.plan.name, daysLeft, inApp: true, email: emailStatus })
  }

  return jsonOk({
    checked: subs.length,
    notified: results.length,
    channels: { inApp: 'always', email: mailTransport === 'resend' ? 'resend' : 'not-configured', sms: 'not-configured', whatsapp: 'not-configured (wa.me links available in dashboard)' },
    results,
    ranAt: now.toISOString(),
  })
}
