'use client'

// Self-service login-email change dialog, shared by Shop Admin and Super Admin.
// Password-confirmed on the server. The current session stays valid (the auth
// cookie references the session token, not the email).
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { AtSign, Loader2 } from 'lucide-react'

export function ChangeEmailDialog({
  open,
  onOpenChange,
  currentEmail,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  currentEmail: string
  onDone?: (newEmail: string) => void
}) {
  const { toast } = useToast()
  const [password, setPassword] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const res = await fetch('/api/auth/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: password, newEmail: next }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not change the email')
      toast({ title: 'Login email updated', description: `Future sign-ins and password-reset codes now go to ${data.email}.` })
      onOpenChange(false)
      setPassword('')
      setNext('')
      onDone?.(data.email)
    } catch (err) {
      toast({ title: 'Failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AtSign className="h-4 w-4" aria-hidden /> Change login email</DialogTitle>
          <DialogDescription>
            Current email: {currentEmail}. Password-reset codes and sign-ins will use the new email. You stay signed in.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="ce-current">Current password</Label>
            <Input id="ce-current" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ce-new">New email</Label>
            <Input id="ce-new" type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} placeholder="name@newmail.in" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !password || !next.includes('@')}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Update email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
