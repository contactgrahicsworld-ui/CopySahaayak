'use client'

// Live plan clock for the shop dashboard: shows the plan name, a real ticking
// digital clock (date + hh:mm:ss, IST) and the plan expiry date/time with a
// running countdown. Colour shifts to amber in the last 7 days and red once
// expired — the owner always knows exactly how long the plan will run.
import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'

function istParts(d: Date): { date: string; time: string } {
  return {
    date: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function PlanClock({ planName, status, expiresAt }: { planName: string; status: string; expiresAt: string | null }) {
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

  const tone = expired
    ? 'border-red-300 bg-red-50 text-red-900'
    : expiresAt && msLeft <= 7 * 86400_000
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : 'border-emerald-300 bg-emerald-50 text-emerald-900'

  return (
    <div role="timer" className={`mb-4 flex flex-col lg:flex-row lg:items-center gap-3 rounded-lg border px-4 py-3 ${tone}`}>
      <div className="flex items-center gap-2 lg:w-56 shrink-0">
        <Clock className="h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs opacity-80">Current plan</p>
          <p className="font-bold text-sm truncate">{planName}</p>
        </div>
      </div>

      <div className="lg:border-l lg:pl-4">
        <p className="text-xs opacity-80">Aaj (IST)</p>
        <p className="font-mono text-lg sm:text-xl font-bold tabular-nums leading-tight">
          {cur.date} · {cur.time}
        </p>
      </div>

      {expiresAt && (
        <div className="lg:border-l lg:pl-4 lg:ml-auto">
          <p className="text-xs opacity-80">
            {status === 'ACTIVE' ? 'Plan expire' : `Plan ${status}`} — {exp?.date} · {exp?.time}
          </p>
          {expired ? (
            <p className="font-mono text-lg sm:text-xl font-bold tabular-nums leading-tight">EXPIRED — plan renew karein</p>
          ) : (
            <p className="font-mono text-lg sm:text-xl font-bold tabular-nums leading-tight">
              Baaki: {days} din {pad(hours)}:{pad(mins)}:{pad(secs)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
