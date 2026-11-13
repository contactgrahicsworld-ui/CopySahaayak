// Chunked backup/restore client for both scopes.
//   SYSTEM scope (Super Admin Settings tab) — full platform system file.
//   SHOP scope  (Shop Admin Settings tab)   — own business system file.
// The transfer protocol matches the API: backup = create job → fetch N text
// chunks → base64 → gzip Blob download; restore = pick .json.gz → begin →
// upload N parts → commit (password-confirmed).
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { Upload, DatabaseBackup, Loader2, FileArchive } from 'lucide-react'

type Scope = 'SYSTEM' | 'SHOP'
const PART_BYTES = 1_400_000 // must match server CHUNK_RAW_BYTES

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function BackupRestoreCard({ scope, title }: { scope: Scope; title: string }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'' | 'backup' | 'restore'>('')
  const [progress, setProgress] = useState('')
  const isShop = scope === 'SHOP'
  const fileHint = isShop
    ? 'Business backup me aapki dukaan ka poora data aata hai — orders, customers ke files, payments, pricing, printers. Login/password aur plan-billing isme NAHI hota (wo platform ke paas rahta hai).'
    : 'System backup me poora platform aata hai — sabhi shops, unke orders/files, users aur system settings. Is file ki security bahut zaroori hai.'

  async function doBackup() {
    if (!password) return toast({ title: 'Pehle apna password bharein', variant: 'destructive' })
    setBusy('backup'); setProgress('Backup taiyar ho raha hai…')
    try {
      const res = await fetch(scope === 'SYSTEM' ? '/api/super/system-backup' : '/api/admin/shop-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Backup create failed')
      const { jobId, parts, filename } = j as { jobId: string; parts: number; filename: string }
      const collected: string[] = []
      for (let i = 0; i < parts; i++) {
        setProgress(`Chunk ${i + 1}/${parts} download ho raha hai…`)
        const pres = await fetch(`${scope === 'SYSTEM' ? '/api/super/system-backup' : '/api/admin/shop-backup'}?jobId=${jobId}&part=${i}`, { cache: 'no-store' })
        const pj = await pres.json()
        if (!pres.ok) throw new Error(pj.error || `Chunk ${i} failed`)
        collected.push(pj.payload as string)
      }
      setProgress('File save ho rahi hai…')
      const bytes = base64ToBytes(collected.join(''))
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/gzip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename; a.click()
      URL.revokeObjectURL(url)
      await fetch(scope === 'SYSTEM' ? `/api/super/system-backup?jobId=${jobId}` : `/api/admin/shop-backup?jobId=${jobId}`, { method: 'DELETE' })
      toast({ title: 'Backup download ho gaya', description: `${filename} ko safe jagah rakhein` })
    } catch (err) {
      toast({ title: 'Backup fail hua', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setBusy(''); setPassword(''); setProgress('')
    }
  }

  async function doRestore(file: File) {
    setBusy('restore')
    try {
      setProgress('File padhi ja rahi hai…')
      const buf = await file.arrayBuffer()
      const b64 = bufToBase64(buf)
      const parts = Math.max(1, Math.ceil(b64.length / PART_BYTES))
      setProgress('Restore session shuru…')
      const beginRes = await fetch(scope === 'SYSTEM' ? '/api/super/system-restore' : '/api/admin/shop-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'begin', parts }),
      })
      const beginJ = await beginRes.json()
      if (!beginRes.ok) throw new Error(beginJ.error || 'Restore begin failed')
      const jobId = beginJ.jobId as string
      for (let i = 0; i < parts; i++) {
        setProgress(`Chunk ${i + 1}/${parts} upload ho raha hai…`)
        const pres = await fetch(scope === 'SYSTEM' ? '/api/super/system-restore' : '/api/admin/shop-restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'part', jobId, idx: i, payload: b64.slice(i * PART_BYTES, (i + 1) * PART_BYTES) }),
        })
        const pj = await pres.json()
        if (!pres.ok) throw new Error(pj.error || `Part ${i} failed`)
      }
      if (!password) throw new Error('Pehle apna password bharein')
      setProgress('Restore chal raha hai — band na karein…')
      const commitRes = await fetch(scope === 'SYSTEM' ? '/api/super/system-restore' : '/api/admin/shop-restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'commit', jobId, password }),
      })
      const commitJ = await commitRes.json()
      if (!commitRes.ok) throw new Error(commitJ.error || 'Restore commit failed')
      toast({ title: 'Restore poora hua', description: isShop ? 'Aapka business data wapas aa gaya. Page refresh karein.' : 'Poora system backup se wapas ban gaya. Dobara login karein.' })
      if (scope === 'SYSTEM') setTimeout(() => { window.location.href = '/super/login' }, 2500)
      else setTimeout(() => { window.location.reload() }, 1500)
    } catch (err) {
      toast({ title: 'Restore fail hua — data untouched hai', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setBusy(''); setPassword(''); setProgress('')
      const el = document.getElementById(`restore-file-${scope}`) as HTMLInputElement | null
      if (el) el.value = ''
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><DatabaseBackup className="h-4 w-4" aria-hidden /> {title}</CardTitle>
        <CardDescription className="text-xs">{fileHint}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor={`bkpass-${scope}`} className="text-xs">Apna password (confirm)</Label>
          <Input id={`bkpass-${scope}`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {progress && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {progress}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={doBackup} disabled={busy !== ''}>
            {busy === 'backup' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <FileArchive className="h-4 w-4 mr-1.5" aria-hidden />}
            Backup download (system file)
          </Button>
          <label className="inline-flex">
            <input
              id={`restore-file-${scope}`}
              type="file"
              accept=".gz,.json,application/gzip,application/json"
              className="sr-only"
              disabled={busy !== ''}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) doRestore(f) }}
            />
            <span
              className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium h-9 px-3 border border-input bg-background hover:bg-accent cursor-pointer"
              aria-hidden={false}
              role="button"
            >
              {busy === 'restore' ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <Upload className="h-4 w-4 mr-1.5" aria-hidden />}
              Restore (file chunein)
            </span>
          </label>
        </div>
        {isShop && (
          <p className="text-xs text-muted-foreground">
            Excel wala backup (orders/payments ki spreadsheet) Reports tab me hai — wo sirf aapke hi dashboard se download hota hai.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
