'use client'

// One-time platform setup: the FIRST visitor creates the Super Admin account.
// After that this page locks itself permanently.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShieldCheck, Loader2, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function SetupPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [done, setDone] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [upiVpa, setUpiVpa] = useState('')
  const [upiPayeeName, setUpiPayeeName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json())
      .then((d) => {
        setDone(!!d.setupDone)
        setChecking(false)
      })
      .catch(() => setChecking(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, phone: phone || undefined, upiVpa: upiVpa || undefined, upiPayeeName: upiPayeeName || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      toast.success('Super admin created. Please sign in.')
      router.push('/login?next=/super')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Setup failed')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <ShieldCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />
          <CardTitle className="text-xl">CopySahaayak — First-time setup</CardTitle>
          <CardDescription>
            {checking
              ? 'Checking…'
              : done
                ? 'Setup is already completed. Create your account below or sign in.'
                : 'Create the platform Super Admin account. This page locks after the first account.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {checking ? (
            <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin" aria-hidden /></div>
          ) : done ? (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="h-10 w-10 mx-auto text-green-600" aria-hidden />
              <p className="text-sm text-muted-foreground">
                A Super Admin already exists. For security, this setup page is permanently locked.
              </p>
              <div className="flex flex-col gap-2">
                <Button asChild><Link href="/login">Sign in</Link></Button>
                <Button asChild variant="outline"><Link href="/register">Register a new shop</Link></Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aman Verma" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Admin email</Label>
                <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.in" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone (optional)</Label>
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ chars, letters and digits" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="upi">Your UPI ID (platform earnings)</Label>
                <Input id="upi" value={upiVpa} onChange={(e) => setUpiVpa(e.target.value)} placeholder="name@okhdfcbank" />
                <p className="text-xs text-muted-foreground">Shop owners pay for their plans here — every subscription payment lands in this UPI account. You can change it later in Super Admin → Settings.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payee">UPI payee name (shown in payer apps)</Label>
                <Input id="payee" maxLength={60} value={upiPayeeName} onChange={(e) => setUpiPayeeName(e.target.value)} placeholder="e.g. CopySahaayak Platforms" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Create Super Admin
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
