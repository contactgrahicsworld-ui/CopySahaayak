'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
  const router = useRouter()
  const params = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [setupPending, setSetupPending] = useState(false)

  useEffect(() => {
    // Show the one-time platform setup link only while no SUPER_ADMIN exists.
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => setSetupPending(Boolean(d?.data && d.data.setupDone === false)))
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
      const next = params.get('next')
      if (next && next.startsWith('/')) router.push(next)
      else router.push(data.user.role === 'SUPER_ADMIN' ? '/super' : '/admin')
      router.refresh()
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
