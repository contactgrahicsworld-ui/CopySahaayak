'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Printer, Loader2 } from 'lucide-react'
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
  const params = useSearchParams()
  const nextParam = params.get('next')
  const isSuperAttempt = nextParam === '/super'
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
      // Opening /super with a shop-owner account is the #1 login confusion: the
      // guard would silently bounce them to their shop dashboard. Say it plainly,
      // give the page a moment to show this toast, and the dashboard banner takes
      // over after the redirect.
      if (isSuperAttempt && data.user?.role !== 'SUPER_ADMIN') {
        toast.warning(
          'Aapka account Dukaan Owner hai, Super Admin nahi — dukaan ka dashboard khul raha hai. Super Admin panel ke liye alag platform super account se sign in karein.',
          { duration: 3500 },
        )
        await new Promise((r) => setTimeout(r, 1500))
        window.location.assign('/admin?notice=super-only')
        return
      }
      const next = params.get('next')
      // Hard navigation instead of router.push: guarantees the fresh session
      // cookie is used by server components on every browser, and can never
      // silently race (a stuck disabled button with no navigation).
      window.location.assign(next && next.startsWith('/') ? next : data.user.role === 'SUPER_ADMIN' ? '/super' : '/admin')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <Printer className="h-8 w-8 mx-auto mb-2" aria-hidden />
          <CardTitle className="text-xl">CopySahaayak</CardTitle>
          <CardDescription>Shop owner or platform admin sign in</CardDescription>
        </CardHeader>
        <CardContent>
          {isSuperAttempt && (
            <div role="note" className="mb-4 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2.5 text-xs text-sky-900">
              <b>Super Admin panel</b> — platform ka super account use karein (jo aapne sabse pehle setup ke waqt banaya tha;
              email/password dukaan owner account se alag hai). Shop owner account se sign in karne par dukaan ka dashboard khulega.
            </div>
          )}
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
            <Link href="/register" className="underline">New shop? Create account</Link>
          </p>
          <p className="text-xs text-center mt-2">
            <Link href="/" className="underline">Back to home</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
