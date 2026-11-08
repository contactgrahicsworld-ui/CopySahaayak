'use client'

// Shop Owner ONLY login. The Super Admin has a separate portal (/super/login)
// so the two account types can never be confused — a super signing in here is
// rejected and their accidental session destroyed, never silently routed.
import { Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Store, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [setupPending, setSetupPending] = useState(false)

  useEffect(() => {
    // Show the one-time platform setup link only while no SUPER_ADMIN exists.
    // /api/setup responds { setupDone: boolean } at the top level.
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => setSetupPending(d?.setupDone === false))
      .catch(() => {})
    // Already signed in? Go straight to the right portal.
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.role === 'SHOP_ADMIN') window.location.assign('/admin')
        else if (d?.user?.role === 'SUPER_ADMIN') window.location.assign('/super')
      })
      .catch(() => {})
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
      if (data.user?.role === 'SUPER_ADMIN') {
        // Shop-owner portal: a super signing in here gets bounced out immediately
        // (session destroyed) — the Super Admin portal is a separate button.
        await fetch('/api/auth/logout', { method: 'POST' })
        toast.error(
          'Ye login sirf Shop Owner ke liye hai. Aapka account Super Admin hai — home page par "Super Admin" button use karein.',
          { duration: 5000 },
        )
        setLoading(false)
        return
      }
      // Hard navigation instead of router.push: guarantees the fresh session
      // cookie is used by server components on every browser, and can never
      // silently race (a stuck disabled button with no navigation).
      window.location.assign('/admin')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Store className="h-8 w-8 mx-auto mb-2" aria-hidden />
          <CardTitle className="text-xl">Shop Owner sign in</CardTitle>
          <CardDescription>Apni dukaan ka dashboard — sirf dukaan owner account ke liye</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@shop.in" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Sign in
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Customer? You don&apos;t need an account — just scan the shop QR or open the shop link.
          </p>
          <p className="text-xs text-center mt-2">
            {setupPending && (
              <>
                <Link href="/setup" className="underline font-medium">First-time platform setup</Link>
                {' · '}
              </>
            )}
            <Link href="/forgot-password" className="underline">Forgot password?</Link>
            {' · '}
            <Link href="/register" className="underline">New shop? 7-day free trial</Link>
          </p>
          <p className="text-xs text-center mt-2">
            Platform owner? Home page par <b>“Super Admin”</b> button use karein ·
            <Link href="/" className="underline"> Back to home</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
