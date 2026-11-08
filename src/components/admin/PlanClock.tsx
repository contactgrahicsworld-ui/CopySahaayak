'use client'

// Live plan clock for the shop dashboard — premium segmented design:
//   [ plan badge + status ]  [ दिन | घंटे | मिनट | सेकंड countdown boxes ]
//   [ progress bar: plan time elapsed vs total ]  [ expiry + now (IST) ]
// Colour shifts to amber in the last 7 days and red once expired, with a
// clear "renew" call-out. The owner always knows exactly how long the plan
// will run — at a glance, on mobile and desktop.
import { useEffect, useState } from 'react'
import { Timer, CalendarClock } from 'lucide-react'

function istParts(d: Date): { date: string; time: string } {
  return {
    date: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

const TONES = {
  ok: {
    wrap: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/60',
    accent: 'bg-emerald-100 text-emerald-700',
    pill: 'bg-emerald-600 text-white',
    box: 'bg-white/85 border-emerald-200 text-emerald-950',
    bar: 'bg-emerald-500',
    text: 'text-emerald-900',
  },
  warn: {
    wrap: 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-amber-50/60',
    accent: 'bg-amber-100 text-amber-700',
    pill: 'bg-amber-600 text-white',
    box: 'bg-white/85 border-amber-200 text-amber-950',
    bar: 'bg-amber-500',
    text: 'text-amber-900',
  },
  danger: {
    wrap: 'border-red-200 bg-gradient-to-br from-red-50 via-white to-red-50/60',
    accent: 'bg-red-100 text-red-700',
    pill: 'bg-red-600 text-white',
    box: 'bg-white/85 border-red-200 text-red-950',
    bar: 'bg-red-500',
    text: 'text-red-900',
  },
}

export function PlanClock({
  planName,
  status,
  expiresAt,
  startsAt,
}: {
  planName: string
  status: string
  expiresAt: string | null
  startsAt?: string | null
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const cur = istParts(now)
  let msLeft = 0
  if (expiresAt) msLeft = new Date(expiresAt).getTime() - now.getTime()
  const expired = !!expiresAt && msLeft <= 0
  const days = Math.max(0, Math.floor(msLeft / 86400_000))
  const hours = Math.max(0, Math.floor((msLeft % 86400_000) / 3600_000))
  const mins = Math.max(0, Math.floor((msLeft % 3600_000) / 60_000))
  const secs = Math.max(0, Math.floor((msLeft % 60_000) / 1000))
  const exp = expiresAt ? istParts(new Date(expiresAt)) : null

  // Plan-time progress: how much of the window between startsAt and expiresAt
  // has already elapsed (only meaningful when both bounds exist).
  let pct: number | null = null
  if (startsAt && expiresAt) {
    const s = new Date(startsAt).getTime()
    const e = new Date(expiresAt).getTime()
    if (e > s) pct = Math.min(100, Math.max(0, ((now.getTime() - s) / (e - s)) * 100))
  }

  const tone = expired ? TONES.danger : expiresAt && msLeft <= 7 * 86400_000 ? TONES.warn : TONES.ok
  const isTrial = /trial/i.test(planName)

  const boxes: Array<[string, string]> = [
    [String(days), 'दिन'],
    [pad(hours), 'घंटे'],
    [pad(mins), 'मिनट'],
    [pad(secs), 'सेकंड'],
  ]

  return (
    <div role="timer" aria-label="Plan clock" className={`mb-4 rounded-xl border shadow-sm px-4 py-3.5 sm:px-5 transition-colors ${tone.wrap}`}>
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
        {/* Plan identity */}
        <div className="flex items-center gap-3 lg:w-52 shrink-0 min-w-0">
          <span className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${tone.accent}`} aria-hidden>
            <Timer className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-60">Plan · प्लान</p>
            <p className="flex items-center gap-1.5 min-w-0">
              <span className="font-bold text-sm truncate">{planName}</span>
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.pill}`}>
                {expired ? 'EXPIRED' : status === 'ACTIVE' ? (isTrial ? 'TRIAL' : 'ACTIVE') : status}
              </span>
            </p>
          </div>
        </div>

        {/* Countdown boxes */}
        {expiresAt && !expired && (
          <div className="flex items-center gap-1.5 lg:gap-2">
            {boxes.map(([v, l]) => (
              <div key={l} className={`flex flex-col items-center rounded-lg border px-2 py-1 sm:px-2.5 min-w-[3rem] sm:min-w-[3.6rem] ${tone.box}`}>
                <span className="font-mono text-lg sm:text-xl font-bold tabular-nums leading-none">{v}</span>
                <span className="text-[9px] font-medium opacity-70 mt-0.5">{l}</span>
              </div>
            ))}
            <span className="text-xs opacity-60 ml-1 hidden sm:inline">बाकी</span>
          </div>
        )}

        {/* Expiry + now */}
        <div className="lg:ml-auto lg:text-right min-w-0">
          {expiresAt ? (
            expired ? (
              <p className={`font-bold text-sm ${tone.text}`}>
                Plan समाप्त — नए order बंद हैं। अभी renew करें (Subscription tab)।
              </p>
            ) : (
              <p className="text-xs opacity-80 flex lg:justify-end items-center gap-1">
                <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
                <span>
                  समाप्त होगा: <strong className="font-semibold">{exp?.date}</strong> · <span className="font-mono">{exp?.time}</span> IST
                </span>
              </p>
            )
          ) : (
            <p className="text-xs opacity-80">Plan expiry set नहीं है</p>
          )}
          <p className="text-[11px] opacity-60 font-mono tabular-nums mt-0.5">अभी (IST): {cur.date} · {cur.time}</p>
        </div>
      </div>

      {/* Progress */}
      {expiresAt && pct !== null && (
        <div className="mt-2.5 flex items-center gap-2.5">
          <div className="h-1.5 flex-1 rounded-full bg-black/10 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${tone.bar}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] font-semibold opacity-70 tabular-nums shrink-0">{Math.round(pct)}%</span>
        </div>
      )}
    </div>
  )
}
