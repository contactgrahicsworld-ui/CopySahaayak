'use client'

// Super Admin creation — SIMPLE by design (owner request: "page complex mat
// banao"). ONE form, ONE button:
//   • Fresh platform            → Email + Password + Confirm. Bas.
//   • Recovery/locked platform  → same form + one Recovery key box.
// No claim tokens in the UI, no two-step flow, no name/phone/UPI fields —
// name auto-derives from the email and UPI is set later in Settings.
// Credentials are NEVER provided by the app or a script: the owner types
// their own email and password here, exactly once.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShieldCheck, Loader2, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function SetupPage() {
  const [checking, setChecking] = useState(true)
  const [locked, setLocked] = useState(false)        // a super admin already exists
  const [needsKey, setNeedsKey] = useState(false)    // platform is in recovery state
  const [recoveryMode, setRecoveryMode] = useState(false) // owner opened recovery from the locked screen
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [resetKey, setResetKey] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => {
        if (d?.setupDone) setLocked(true)
        if (d?.recoveryRequired) setNeedsKey(true)
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      toast.error('Password aur confirm password same nahi hai')
      return
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      toast.error('Password me kam se kam 8 characters hone chahiye — letters + numbers')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(resetKey ? { resetKey } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      toast.success('Super Admin account ban gaya! Ab login karo.')
      window.location.assign('/super/login?created=1')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Setup failed')
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </main>
    )
  }

  // Platform already has an owner: stay locked, offer ONLY the simple
  // self-service recovery (no support ticket, no preset credentials).
  if (locked && !recoveryMode) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <ShieldCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />
            <CardTitle className="text-xl">Setup already completed</CardTitle>
            <CardDescription>
              Platform owner pehle se bana hua hai. Sign in karo — ya password bhool gaye ho to neeche recovery se KHUD naya banao.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild className="w-full">
              <Link href="/super/login">Super Admin sign in</Link>
            </Button>
            <div className="mt-5 border-t pt-4">
              <p className="text-xs text-muted-foreground mb-2">Password bhool gaye?</p>
              <Button variant="outline" className="w-full" onClick={() => setRecoveryMode(true)}>
                <KeyRound className="h-4 w-4 mr-2" aria-hidden />
                Recovery se naya account banao
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  const showKey = needsKey || recoveryMode

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />
          <CardTitle className="text-xl">Super Admin account banao</CardTitle>
          <CardDescription>
            {showKey
              ? 'Recovery key paste karo aur APNA naya email + password set karo.'
              : 'Apna email aur password KHUD set karo. App ya script koi password nahi deti.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-3 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            Ye page <b>sirf platform owner</b> ke liye hai. Dukaan register karne ke liye home page par <b>“Shop Owner”</b> use karein.
          </p>
          <form onSubmit={submit} className="space-y-4">
            {showKey && (
              <div className="space-y-1.5">
                <Label htmlFor="resetKey">Recovery key</Label>
                <Input id="resetKey" type="password" required autoComplete="off" value={resetKey} onChange={(e) => setResetKey(e.target.value)} placeholder="bk-…" />
                <p className="text-[11px] text-muted-foreground">Aapke paas di gayi emergency key — bas paste kar do.</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email (login ID)</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aapka@email.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters, letters + numbers" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Wahi password dobara" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Account banao
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            <Link href="/super/login" className="underline">Sign in</Link> ·
            <Link href="/" className="underline"> Back to home</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
