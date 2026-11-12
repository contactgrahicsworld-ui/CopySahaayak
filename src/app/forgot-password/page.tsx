'use client'

// Forgot password: request a 6-digit email OTP, then set a new password.
// Works for every account type — shop owners AND the platform's Super Admin.
// The email is delivered by Supabase's built-in free-tier mailer; the code is
// verified server-side before the bcrypt password is updated and every old
// session is revoked.
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { KeyRound, Loader2, MailCheck } from 'lucide-react'
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
              : `${email} par bheja gaya code daalo aur naya password set karo.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {stage === 'EMAIL' ? (
            <form onSubmit={requestOtp} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Account ka email</Label>
                <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aapka@email.com" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Code bhejo
              </Button>
            </form>
          ) : (
            <form onSubmit={submitReset} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code">Email wala 6-digit code</Label>
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
