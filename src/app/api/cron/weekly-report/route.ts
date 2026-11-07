// Weekly backup + revenue report (Vercel Cron, Sunday 04:00 IST and Monday
// flush, or manual with the CRON_SECRET/APP_SECRET). Every shop admin and every
// super admin gets a designed HTML revenue report with the week's Excel backup
// attached. Sends are sequential and budgeted — leftovers stay queued for the
// next run so free-tier mail limits are never exceeded.
import { jsonOk, jsonError } from '@/lib/api'
import { timingSafeEqualStr } from '@/lib/security'
import { seedWeeklyQueue, processWeeklyQueue } from '@/lib/weekly-report'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const secret = process.env.CRON_SECRET || process.env.APP_SECRET || ''
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || url.searchParams.get('secret') || ''
  if (!secret || !timingSafeEqualStr(secret, provided)) {
    return jsonError(404, 'Not found')
  }

  const budgetMs = Math.min(Number(url.searchParams.get('budgetMs') ?? '50000'), 55000)
  const maxSends = Math.min(Number(url.searchParams.get('max') ?? '4'), 10)

  const seeded = await seedWeeklyQueue()
  const outcome = await processWeeklyQueue(budgetMs, maxSends)

  return jsonOk({
    ok: true,
    week: { start: seeded.weekStart.toISOString(), end: seeded.weekEnd.toISOString() },
    seeded: seeded.seeded,
    alreadyQueued: seeded.existing,
    ...outcome,
  })
}
