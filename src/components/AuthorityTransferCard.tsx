'use client'

// Power of Attorney — Authority Transfer card, shared by both dashboards.
// The current authority (shop owner or super admin) hands the COMPLETE
// dashboard + payment authority to a new person by email. The new person
// receives a one-time link (like a forgot-password mail), sets their own
// password, and instantly receives full authority; the previous authority is
// signed out everywhere. Nothing changes until the link is accepted, and it
// can be cancelled any time while pending.
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, FileOutput, XCircle, Clock3 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

interface Pending {
  toName: string
  toEmail: string
  fromEmail: string
  expiresAt: string
}

export function AuthorityTransferCard({ scope, apiBase }: { scope: 'SHOP' | 'PLATFORM'; apiBase: '/api/admin/transfer' | '/api/super/transfer' }) {
  const { toast } = useToast()
  const [pending, setPending] = useState<Pending | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [toName, setToName] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    fetch(apiBase, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setPending(d.pending || null))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [apiBase])

  async function initiate(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toName, toEmail, currentPassword }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Transfer failed')
      setOpen(false)
      setCurrentPassword('')
      toast({
        title: 'Email bhej diya gaya / Transfer email sent',
        description: `${toEmail} ko one-time link mil gaya hai (24h valid). Jaise hi wo link kholkar apna password set karega, poora authority uske paas aa jayega — Power of Attorney jaisa.`,
      })
      fetch(apiBase, { cache: 'no-store' }).then((r) => r.json()).then((x) => setPending(x.pending || null)).catch(() => {})
    } catch (err) {
      toast({ title: 'Transfer failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function cancelTransfer() {
    setCancelling(true)
    try {
      const res = await fetch(apiBase, { method: 'DELETE' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Cancel failed')
      setPending(null)
      toast({ title: 'Transfer cancelled / ट्रांसफर रद्द', description: 'पुराना अधिकारी (आप) पूरी तरह active रहेगे।' })
    } catch (err) {
      toast({ title: 'Cancel failed', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <>
      <Card className="max-w-xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileOutput className="h-4 w-4" aria-hidden /> Authority Transfer — Power of Attorney
            <Badge variant="outline" className="ml-1 text-[10px]">{scope === 'PLATFORM' ? 'Platform' : 'Dukaan'}</Badge>
          </CardTitle>
          <CardDescription>
            Dukaan ya platform ka poora authority (dashboard, orders, payments, UPI settings) kisi aur ko dena ho —
            jaise Power of Attorney — to naye vyakti ka naam + email daalein. Us email par one-time link jayega
            (24h valid); link kholte hi apna password set karke usse <strong>poora authority</strong> mil jayega aur aapka saara
            access band ho jayega. Jab tak link accept nahi hota, kuch nahi badalta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          ) : pending ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
              <p className="flex items-center gap-1.5 font-medium"><Clock3 className="h-3.5 w-3.5" aria-hidden /> Transfer pending — link bheja gaya:</p>
              <p className="mt-1">
                <strong>{pending.toName}</strong> ({pending.toEmail}) · expires{' '}
                {new Date(pending.expiresAt).toLocaleString('en-IN')}
              </p>
              <p className="mt-1 text-xs">Jab tak wo link accept nahi karta, authority aapke paas hi hai. Manzil badal gayi? Cancel karein.</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={cancelTransfer} disabled={cancelling}>
                {cancelling && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden />}Cancel transfer
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Transfer authority…</Button>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) {
            setOpen(v)
            if (!v) {
              setToName('')
              setToEmail('')
              setCurrentPassword('')
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileOutput className="h-4 w-4" aria-hidden /> Transfer authority (Power of Attorney)
            </DialogTitle>
            <DialogDescription>
              {scope === 'PLATFORM'
                ? 'Platform ka poora Super Admin authority naye vyakti ko jayega. Aapka account deactivate ho jayega aur saare sessions sign-out ho jayenge (sirf transfer accept hone ke baad).'
                : 'Dukaan ka poora authority naye vyakti ko jayega — orders, payments, UPI ID, devices sab. Aapka access band ho jayega (sirf transfer accept hone ke baad).'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={initiate} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor={`at-name-${scope}`}>New authority&apos;s name / नए अधिकारी का नाम</Label>
              <Input id={`at-name-${scope}`} required minLength={2} maxLength={80} value={toName} onChange={(e) => setToName(e.target.value)} placeholder="e.g. Suresh Kumar" />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`at-email-${scope}`}>New authority&apos;s email / नया login email</Label>
              <Input id={`at-email-${scope}`} type="email" required autoComplete="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="newowner@example.in" />
              <p className="text-xs text-muted-foreground">Email par one-time accept link jayega (24h). Ye email pehle se active account me na ho.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`at-pw-${scope}`}>Your current password (proof of authority)</Label>
              <Input id={`at-pw-${scope}`} type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <p className="text-xs rounded-md border border-sky-300 bg-sky-50 text-sky-900 px-3 py-2">
              Password confirm karna zaroori hai — koi chori hua session akele authority transfer nahi kar sakta.
              Link accept hone se pehle kabhi bhi cancel kar sakte hain.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}><XCircle className="h-4 w-4 mr-1.5" aria-hidden />Cancel</Button>
              <Button type="submit" disabled={busy || !toName || !toEmail || !currentPassword}>
                {busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden />}Send transfer email
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
