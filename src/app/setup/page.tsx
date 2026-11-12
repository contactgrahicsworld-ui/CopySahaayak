'use client'

// First-run platform setup: the FIRST Super Admin creates their own account here.
// No credentials ship with the app, no script fills them — the platform owner
// types their own name/email/password on this page. This page is only reachable
// while no active SUPER_ADMIN exists (GET /api/setup → setupDone:false), and
// locks forever after. This page is for the PLATFORM OWNER ONLY — shop owners
// register via the "Shop Owner" entry on the home page (/register), never here.
//
// Emergency recovery: if the platform ALREADY had a super admin whose credentials
// are lost, creation needs a one-time CLAIM TOKEN. The platform owner enters the
// deployment's SUPER_SETUP_RESET_KEY below — it never leaves this page — and the
// server issues the 15-minute claim token that unlocks exactly ONE fresh
// creation. Old credentials are deleted on reset. The recovery entry stays
// available from the locked screen too, so a lost password is always
// self-recoverable without any support ticket.
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
  const [locked, setLocked] = useState(false)
  const [recoveryRequired, setRecoveryRequired] = useState(false)
  const [claimToken, setClaimToken] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [phone, setPhone] = useState('')
  const [upiVpa, setUpiVpa] = useState('')
  const [upiPayeeName, setUpiPayeeName] = useState('')
  const [loading, setLoading] = useState(false)
  const [resetKey, setResetKey] = useState('')
  const [resetting, setResetting] = useState(false)
  // Recovery must stay reachable even when a super admin exists (locked screen):
  // a lost password is recovered by the OWNER here, never by a preset credential.
  const [recoveryOpen, setRecoveryOpen] = useState(false)

  useEffect(() => {
    // /api/setup responds { setupDone, recoveryRequired } at the top level.
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => {
        if (d?.setupDone) setLocked(true)
        if (d?.recoveryRequired) setRecoveryRequired(true)
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  async function runRecovery(e: React.FormEvent) {
    e.preventDefault()
    setResetting(true)
    try {
      const res = await fetch('/api/setup/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetKey }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Recovery failed')
      setClaimToken(d.claimToken)
      setRecoveryRequired(false)
      setLocked(false)
      setRecoveryOpen(false)
      toast.success('पुराना Super Admin हटा दिया गया — अब नया account बनाएं / Old super admin removed. Create the new account now.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recovery failed')
    } finally {
      setResetting(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      toast.error('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          phone: phone || undefined,
          upiVpa: upiVpa || undefined,
          upiPayeeName: upiPayeeName || undefined,
          ...(claimToken ? { claimToken } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      toast.success('Platform owner account created! Now sign in.')
      // Hard navigation to the SUPER-ONLY login — the created account can only
      // sign in through the Super Admin portal.
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

  if (locked && !claimToken) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <ShieldCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />
            <CardTitle className="text-xl">Setup already completed</CardTitle>
            <CardDescription>
              A platform owner already exists. Sign in instead — this one-time setup page is locked for security.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild className="w-full">
              <Link href="/super/login">Go to Super Admin sign in</Link>
            </Button>
            <div className="mt-5 border-t pt-4">
              <p className="text-xs text-muted-foreground mb-2">Super Admin credentials kho gaye?</p>
              <Button variant="outline" className="w-full" onClick={() => setRecoveryOpen(true)}>
                <KeyRound className="h-4 w-4 mr-2" aria-hidden />
                Emergency recovery kholein
              </Button>
              <p className="text-[11px] text-muted-foreground mt-2">
                Recovery key (SUPER_SETUP_RESET_KEY) se purana credential हटकर आप KHUD naya email/password bana sakte hain.
              </p>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  // ---- Emergency recovery gate: the platform had a super admin before, so
  // creation needs the one-time claim token from the break-glass reset. ----
  if ((recoveryRequired || recoveryOpen) && !claimToken) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-muted/30">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <KeyRound className="h-8 w-8 mx-auto mb-2" aria-hidden />
            <CardTitle className="text-xl">Emergency recovery / आपातकालीन रिकवरी</CardTitle>
            <CardDescription>
              पुराना Super Admin credential खो गया है? नीचे deployment की recovery key
              (<code className="text-[11px]">SUPER_SETUP_RESET_KEY</code>) डालें — पुराना account पूरी तरह हट जाएगा और नया बनाने की अनुमति 15 मिनट के लिए मिलेगी।
              <br />
              Lost the platform owner credentials? Enter the recovery key to delete the old super admin and unlock one-time creation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={runRecovery} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="resetKey">Recovery key</Label>
                <Input id="resetKey" type="password" required autoComplete="off" value={resetKey} onChange={(e) => setResetKey(e.target.value)} placeholder="SUPER_SETUP_RESET_KEY value" />
              </div>
              <Button type="submit" className="w-full" variant="destructive" disabled={resetting || resetKey.length < 16}>
                {resetting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Remove old admin &amp; unlock creation
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-4 text-center">
              Recovery key सिर्फ़ platform owner के पास होती है (server environment variable) — यह कभी डेटाबेस में नहीं रहती।
              <br />
              Shops और dukaan ka data is process se untouched rehta hai.
              <br />
              <Link href="/super/login" className="underline">Super Admin sign in</Link> ·
              <Link href="/" className="underline"> Back to home</Link>
            </p>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-muted/30">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />
          <CardTitle className="text-xl">Super Admin account creation</CardTitle>
          <CardDescription>
            {claimToken
              ? 'Recovery unlocked — create the brand-new platform owner account. The old credentials are gone.'
              : 'Create the one platform-owner account. This page works only once — after this it locks permanently.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-3 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            Ye page <b>sirf platform owner (Super Admin)</b> ke liye hai — yahan dukaan owner account nahi banta.
            Dukaan register karne ke liye home page par <b>“Shop Owner”</b> button use karein.
          </p>
          {claimToken && (
            <p className="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-900">
              रिकवरी सफल — पुराना Super Admin credential हटा दिया गया है (purana data/credential removed)। अब बिल्कुल नया account बनाएं।
            </p>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input id="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Verma" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email (login)</Label>
                <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@platform.in" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input id="phone" type="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91-98…" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ chars, letters and digits" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="upiVpa">Platform UPI ID (optional)</Label>
                <Input id="upiVpa" value={upiVpa} onChange={(e) => setUpiVpa(e.target.value)} placeholder="name@okhdfcbank" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="upiPayeeName">UPI payee name (optional)</Label>
                <Input id="upiPayeeName" maxLength={60} value={upiPayeeName} onChange={(e) => setUpiPayeeName(e.target.value)} placeholder="Name shown to shops" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Platform UPI is where shop owners pay for subscription plans. You can also set or change it later in
              Super Admin → Settings.
            </p>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Create platform owner account
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Dukaan owner? Home page par <b>“Shop Owner”</b> button use karein ·
            <Link href="/" className="underline"> Back to home</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
