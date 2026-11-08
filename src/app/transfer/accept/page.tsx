'use client'

// Public ONE-TIME authority acceptance page (Power of Attorney). The emailed
// link lands here: the new authority sees what they are receiving, sets their
// own password once, and is signed straight into the shop dashboard or the
// platform dashboard with the complete authority.
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, ShieldCheck, Store, XCircle, CheckCircle2 } from 'lucide-react'

interface Details {
  scope: 'SHOP' | 'PLATFORM'
  shopName: string | null
  toName: string
  toEmail: string
  fromEmail: string
  expiresAt: string
}

export default function AcceptTransferPage() {
  return (
    <Suspense>
      <AcceptTransferClient />
    </Suspense>
  )
}

function AcceptTransferClient() {
  const params = useSearchParams()
  const token = params.get('token') || ''
  const [phase, setPhase] = useState<'loading' | 'form' | 'done' | 'error'>('loading')
  const [details, setDetails] = useState<Details | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [redirect, setRedirect] = useState('')

  useEffect(() => {
    if (!token) {
      setErrorMsg('This link is missing its token. Use the exact link from the authority-transfer email.')
      setPhase('error')
      return
    }
    fetch(`/api/transfer/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Invalid link')
        setDetails(d.transfer)
        setName(d.transfer.toName || '')
        setPhase('form')
      })
      .catch((e: unknown) => {
        setErrorMsg(e instanceof Error ? e.message : 'Invalid link')
        setPhase('error')
      })
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) return
    setBusy(true)
    try {
      const res = await fetch(`/api/transfer/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, name: name || undefined }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Accept failed')
      setPhase('done')
      setRedirect(d.redirect || (d.scope === 'PLATFORM' ? '/super' : '/admin'))
      setTimeout(() => window.location.assign(d.redirect || (d.scope === 'PLATFORM' ? '/super' : '/admin')), 1800)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Accept failed')
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'loading') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </main>
    )
  }

  if (phase === 'done') {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle2 className="h-10 w-10 mx-auto mb-2 text-green-600" aria-hidden />
            <CardTitle className="text-xl">Authority transferred / अधिकार मिल गया</CardTitle>
            <CardDescription>
              पूरा अधिकार अब आपके पास है। डैशबोर्ड खोल रहे हैं…
              <br />Opening your dashboard…
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => window.location.assign(redirect)}>Continue now / अभी खोलें</Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (phase === 'error' || !details) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <XCircle className="h-10 w-10 mx-auto mb-2 text-destructive" aria-hidden />
            <CardTitle className="text-xl">Link not usable / लिंक काम नहीं कर रहा</CardTitle>
            <CardDescription>{errorMsg}</CardDescription>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            वर्तमान अधिकारी (current authority) से कहें कि वह डैशबोर्ड से एक नया transfer link भेजे।
          </CardContent>
        </Card>
      </main>
    )
  }

  const what = details.scope === 'PLATFORM'
    ? 'the complete CopySahaayak platform authority (Super Admin)'
    : `the complete authority of shop "${details.shopName}" — dashboard, orders, payments`

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-muted/30">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          {details.scope === 'PLATFORM' ? (
            <ShieldCheck className="h-8 w-8 mx-auto mb-2" aria-hidden />
          ) : (
            <Store className="h-8 w-8 mx-auto mb-2" aria-hidden />
          )}
          <CardTitle className="text-xl">Accept authority / अधिकार स्वीकार करें</CardTitle>
          <CardDescription>
            <Badge variant={details.scope === 'PLATFORM' ? 'default' : 'secondary'} className="mb-2">
              {details.scope === 'PLATFORM' ? 'Platform (Super Admin)' : 'Shop dashboard'}
            </Badge>
            <br />
            <strong>{details.fromEmail}</strong> has transferred {what} to <strong>{details.toEmail}</strong>.
            <br />
            <span className="text-xs">
              Link valid until {new Date(details.expiresAt).toLocaleString('en-IN')} · one-time use · एक बार चलेगा
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
            अपना नाम और नया पासवर्ड सेट करें — तुरंत पूरा डैशबोर्ड आपके पास आ जाएगा और पुराने अधिकारी का सारा access बंद हो जाएगा।
            Set your own password — the previous authority is signed out everywhere the moment you accept.
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name / आपका नाम</Label>
              <Input id="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ chars, letters and digits" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" required minLength={8} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" />
              </div>
            </div>
            {password && confirm && password !== confirm && (
              <p className="text-xs text-destructive">Passwords do not match / पासवर्ड मेल नहीं खा रहे</p>
            )}
            <Button type="submit" className="w-full" disabled={busy || (password !== confirm)}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Accept &amp; open dashboard
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              यह अपेक्षित नहीं था? इस पेज को बंद कर दें — जब तक आप accept नहीं करते कुछ नहीं बदलता।
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
