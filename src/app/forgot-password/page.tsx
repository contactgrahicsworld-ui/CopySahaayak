'use client'

// Forgot password: request a 6-digit email OTP, then set a new password.
// Works for every account type — shop owners AND the platform's Super Admin.
// The email is delivered by Supabase's built-in free-tier mailer; the code is
// verified server-side before the bcrypt password is updated and every old
// session is revoked.
// Supabase free-tier mail is rate-limited/unreliable, so the page also offers
// OPERATOR RECOVERY: the SUPER_SETUP_RESET_KEY holder claims the 6-digit code
// in-channel (shown on this page) — no email needed at all. The same code
// field below accepts both (server verifies emailed OR app-issued codes).
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KeyRound, Loader2, MailCheck, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  )
}

function ForgotPasswordForm() {
  const router = useRouter()
  const params = useSearchParams()
  const fromSuper = params.get('from') === 'super'
  const [stage, setStage] = useState<'EMAIL' | 'CODE'>('EMAIL')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  // Operator recovery (no email): reset-key gated in-channel OTP claim.
  const [showOperator, setShowOperator] = useState(false)
  const [operatorKey, setOperatorKey] = useState('')
  const [operatorLoading, setOperatorLoading] = useState(false)
  const [operatorCode, setOperatorCode] = useState('')

  const signInHref = fromSuper ? '/super/login' : '/login'
  const signInLabel = fromSuper ? 'Super Admin sign in' : 'Back to sign in'

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
      toast.success('6-digit code email par bhej diya — inbox check karo')
      setStage('CODE')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the email')
    } finally {
      setLoading(false)
    }
  }

  async function operatorClaim(e: React.FormEvent) {
    e.preventDefault()
    setOperatorLoading(true)
    try {
      const res = await fetch('/api/auth/forgot/operator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resetKey: operatorKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Recovery failed')
      setOperatorCode(String(data.code))
      setCode(String(data.code))
      setStage('CODE')
      toast.success('Recovery code mil gaya — 10 minute valid. Neeche naya password set karo.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recovery failed')
    } finally {
      setOperatorLoading(false)
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
      toast.success('Password set ho gaya. Ab sign in karo.')
      // Super admins go back to their own portal; shop owners to theirs.
      router.push(fromSuper ? '/super/login?reset=1' : '/login?reset=1')
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
          <CardTitle className="text-xl">Password bhool gaye?</CardTitle>
          <CardDescription>
            {stage === 'EMAIL'
              ? 'Aapke email par ek 6-digit code bheja jayega.'
              : operatorCode
                ? 'Operator recovery code ready hai (neeche pre-filled). Naya password set karo.'
                : `${email} par bheja gaya code daalo aur naya password set karo.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stage === 'EMAIL' ? (
            <>
              <form onSubmit={requestOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Account ka email</Label>
                  <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aapka@email.com" />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Code bhejo
                </Button>
                <p className="text-xs text-muted-foreground text-center">Email na aaye to Spam/Updates folder bhi check karo.</p>
              </form>
              <div className="mt-4 border-t pt-3">
                <button
                  type="button"
                  onClick={() => setShowOperator(!showOperator)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />Email nahi aa raha? Operator recovery (bina email)
                </button>
                {showOperator && (
                  <form onSubmit={operatorClaim} className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="resetKey">Operator reset key</Label>
                      <Input id="resetKey" type="password" required value={operatorKey} onChange={(e) => setOperatorKey(e.target.value)} placeholder="SUPER_SETUP_RESET_KEY" autoComplete="off" />
                    </div>
                    <Button type="submit" variant="outline" className="w-full" disabled={operatorLoading}>
                      {operatorLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Recovery code yahin dikhao
                    </Button>
                    <p className="text-[11px] text-muted-foreground">Code is page par hi dikhega (10 min valid) — email ki zaroorat nahi. Ye key sirf platform operator ke paas hai.</p>
                  </form>
                )}
              </div>
            </>
          ) : (
            <form onSubmit={submitReset} className="space-y-4">
              {operatorCode && (
                <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-center">
                  <p className="text-xs text-green-700">Operator recovery code (10 min valid):</p>
                  <p className="text-xl font-bold tracking-widest text-green-800">{operatorCode}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="code">6-digit code (email ya operator recovery)</Label>
                <Input id="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="tracking-widest text-center" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Naya password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters, letters + numbers" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Naya password set karo
              </Button>
              <Button type="button" variant="outline" className="w-full" disabled={loading} onClick={() => setStage('EMAIL')}>
                Koi aur email use karo
              </Button>
            </form>
          )}
          <p className="text-xs text-center mt-4">
            <Link href={signInHref} className="underline">{signInLabel}</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
