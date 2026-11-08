'use client'

// Super Admin ONLY login. Kept strictly separate from the shop-owner login so
// the two account types can never be confused: a shop-owner signing in here is
// rejected (and their accidental session destroyed), never silently routed.
import { Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShieldCheck, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export default function SuperLoginPage() {
  return (
    <Suspense>
      <SuperLoginForm />
    </Suspense>
  )
}

function SuperLoginForm() {
  const params = useSearchParams()
  const created = params.get('created') === '1'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Already signed in? Route to the right portal instead of showing a form.
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.role === 'SUPER_ADMIN') window.location.assign('/super')
        else if (d?.user?.role === 'SHOP_ADMIN') window.location.assign('/admin')
        else setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      if (data.user?.role !== 'SUPER_ADMIN') {
        // This login is super-only: destroy the accidental session immediately
        // so a shop-owner session is never left hanging on this page.
        await fetch('/api/auth/logout', { method: 'POST' })
        toast.error(
          'Ye login sirf Super Admin ke liye hai. Aapka account Shop Owner hai — home page par "Shop Owner" button use karein.',
          { duration: 5000 },
        )
        setLoading(false)
        return
      }
      // Hard navigation: guarantees the fresh session cookie is used by the
      // server components — can never silently race.
      window.location.assign('/super')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
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

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />
          <CardTitle className="text-xl">Super Admin sign in</CardTitle>
          <CardDescription>Platform owner ka alag login — sirf Super Admin account ke liye</CardDescription>
        </CardHeader>
        <CardContent>
          {created && (
            <div role="status" className="mb-4 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span>Platform owner account ban gaya! Ab usi email/password se sign in karein.</span>
            </div>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@platform.in" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Sign in as Super Admin
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Dukaan owner hain? Ye login aapke liye nahi hai — home page par <b>&ldquo;Shop Owner&rdquo;</b> button use karein.
          </p>
          <p className="text-xs text-center mt-2">
            <Link href="/forgot-password" className="underline">Forgot password?</Link>
            {' · '}
            <Link href="/" className="underline">Back to home</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
