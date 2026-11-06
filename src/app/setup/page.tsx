'use client'

// First-run platform setup: the FIRST Super Admin creates their own account here.
// No credentials ship with the app — this page is only reachable while no active
// SUPER_ADMIN exists (GET /api/setup → setupDone:false), and locks forever after.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function SetupPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [locked, setLocked] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [phone, setPhone] = useState('')
  const [upiVpa, setUpiVpa] = useState('')
  const [upiPayeeName, setUpiPayeeName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // /api/setup responds { setupDone: boolean } at the top level.
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => {
        if (d?.setupDone) setLocked(true)
      })
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

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
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      toast.success('Platform setup complete. Please sign in.')
      router.push('/login')
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

  if (locked) {
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
              <Link href="/login">Go to sign in</Link>
            </Button>
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
          <CardTitle className="text-xl">First-time platform setup</CardTitle>
          <CardDescription>
            Create the one platform-owner account. This page works only once — after this it locks permanently.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
            Already set up? <Link href="/login" className="underline">Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
