'use client'

// Forgot password: request a 6-digit email OTP, then set a new password.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KeyRound, Loader2, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [stage, setStage] = useState<'EMAIL' | 'CODE'>('EMAIL')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [inlineError, setInlineError] = useState<string | null>(null)

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not send the email')
      setInlineError(null)
      toast.success('6-digit code sent — check your email inbox')
      setStage('CODE')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not send the email'
      toast.error(msg)
      // Persist the guidance (e.g. “email not configured — a Super Admin can
      // reset any password from the dashboard”) — toasts vanish too fast.
      setInlineError(msg)
    } finally {
      setLoading(false)
    }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not reset the password')
      toast.success('Password updated. Please sign in.')
      router.push('/login')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reset the password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {stage === 'EMAIL' ? (
            <KeyRound className="h-8 w-8 mx-auto mb-2" aria-hidden />
          ) : (
            <MailCheck className="h-8 w-8 mx-auto mb-2 text-green-600" aria-hidden />
          )}
          <CardTitle className="text-xl">Forgot password</CardTitle>
          <CardDescription>
            {stage === 'EMAIL'
              ? 'We will email you a 6-digit code.'
              : `Enter the code sent to ${email} and choose a new password.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {inlineError && stage === 'EMAIL' && (
            <div role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {inlineError}
            </div>
          )}
          {stage === 'EMAIL' ? (
            <form onSubmit={requestOtp} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Account email</Label>
                <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@shop.in" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Send code
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                Email delivery not set up on this deployment? A Super Admin can reset any password from the Users tab in the platform dashboard.
              </p>
            </form>
          ) : (
            <form onSubmit={submitReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code">6-digit code from email</Label>
                <Input id="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="tracking-widest text-center" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ chars, letters and digits" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Set new password
              </Button>
              <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={() => setStage('EMAIL')}>
                Use a different email
              </Button>
            </form>
          )}
          <p className="text-xs text-center mt-4">
            <Link href="/login" className="underline">Back to sign in</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
