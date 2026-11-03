'use client'

// Super Admin: Overview · Shops · Subscription payments · Plans · Audit · Settings.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog'
import { useToast } from '@/hooks/use-toast'
import { formatInr } from '@/lib/constants'
import {
  LayoutDashboard, Store, BadgeCheck, Layers, ScrollText, Settings, LogOut, Loader2,
  Plus, RefreshCw, ShieldCheck, ShieldOff, KeyRound, Check, X, Users, Trash2,
} from 'lucide-react'

export function SuperDashboard({ user }: { user: { name: string; email: string } }) {
  const router = useRouter()
  const [tab, setTab] = useState('overview')
  const [pwOpen, setPwOpen] = useState(false)

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">CopySahaayak Platform</p>
            <p className="text-[11px] text-muted-foreground truncate">{user.email} · Super Admin</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setPwOpen(true)} aria-label="Change password">
              <KeyRound className="h-4 w-4 sm:mr-1" aria-hidden /> <span className="hidden sm:inline">Password</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4 sm:mr-1" aria-hidden /> <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-3 sm:px-4 py-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full h-auto flex-nowrap overflow-x-auto no-scrollbar justify-start gap-1 mb-4">
            <TabsTrigger value="overview" className="shrink-0"><LayoutDashboard className="h-4 w-4 mr-1" aria-hidden /> Overview</TabsTrigger>
            <TabsTrigger value="shops" className="shrink-0"><Store className="h-4 w-4 mr-1" aria-hidden /> Shops</TabsTrigger>
            <TabsTrigger value="users" className="shrink-0"><Users className="h-4 w-4 mr-1" aria-hidden /> Users</TabsTrigger>
            <TabsTrigger value="subs" className="shrink-0"><BadgeCheck className="h-4 w-4 mr-1" aria-hidden /> Subs</TabsTrigger>
            <TabsTrigger value="plans" className="shrink-0"><Layers className="h-4 w-4 mr-1" aria-hidden /> Plans</TabsTrigger>
            <TabsTrigger value="audit" className="shrink-0"><ScrollText className="h-4 w-4 mr-1" aria-hidden /> Audit</TabsTrigger>
            <TabsTrigger value="settings" className="shrink-0"><Settings className="h-4 w-4 mr-1" aria-hidden /> Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><OverviewTab /></TabsContent>
          <TabsContent value="shops"><ShopsTab /></TabsContent>
          <TabsContent value="users"><UsersTab /></TabsContent>
          <TabsContent value="subs"><SubsTab /></TabsContent>
          <TabsContent value="plans"><PlansTab /></TabsContent>
          <TabsContent value="audit"><AuditTab /></TabsContent>
          <TabsContent value="settings"><PlatformSettingsTab /></TabsContent>
        </Tabs>
      </div>

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </main>
  )
}

function CenterSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
    </div>
  )
}

function OverviewTab() {
  const [stats, setStats] = useState<{
    shops: { total: number; active: number; suspended: number }
    orders: { total: number; thisMonth: number }
    revenue: { subscriptionAllPaise: number; subscriptionMonthPaise: number }
    pending: { subscriptionPayments: number; shopPayments: number }
    subscriptions: { active: number }
    devices: { registered: number; onlineNow: number }
    storage: { totalBytes: number; documents: number }
    gmvDaily: Array<{ date: string; paise: number }>
  } | null>(null)

  useEffect(() => {
    const load = () => fetch('/api/super/stats', { cache: 'no-store' }).then((r) => r.json()).then(setStats).catch(() => {})
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [])

  if (!stats) return <CenterSpinner />
  const max = Math.max(1, ...stats.gmvDaily.map((d) => d.paise))
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MiniStat label="Shops (active/total)" value={`${stats.shops.active}/${stats.shops.total}`} />
        <MiniStat label="Active subscriptions" value={String(stats.subscriptions.active)} />
        <MiniStat label="Subscription revenue (month)" value={formatInr(stats.revenue.subscriptionMonthPaise)} />
        <MiniStat label="Subscription revenue (all)" value={formatInr(stats.revenue.subscriptionAllPaise)} />
        <MiniStat label="Orders (month/total)" value={`${stats.orders.thisMonth}/${stats.orders.total}`} />
        <MiniStat label="Devices online now" value={String(stats.devices.onlineNow)} />
        <MiniStat label="Pending verifications" value={String(stats.pending.subscriptionPayments + stats.pending.shopPayments)} highlight={stats.pending.subscriptionPayments > 0} />
        <MiniStat label="Storage used" value={`${(stats.storage.totalBytes / 1024 / 1024).toFixed(1)} MB · ${stats.storage.documents} docs`} />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Verified shop payments (last 14 days)</CardTitle></CardHeader>
        <CardContent>
          {stats.gmvDaily.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No verified order payments yet.</p>
          ) : (
            <div className="space-y-1.5">
              {stats.gmvDaily.map((d) => (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground">{d.date.slice(5)}</span>
                  <div className="h-4 rounded bg-primary/70" style={{ width: `${(d.paise / max) * 70}%` }} />
                  <span className="font-medium">{formatInr(d.paise)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className={`text-xl font-bold ${highlight ? 'text-amber-600' : ''}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  )
}

interface ShopRow {
  id: string
  name: string
  slug: string
  phone?: string
  isActive: boolean
  createdAt: string
  subscription: { status: string; expiresAt: string | null; plan: { name: string } } | null
  users: Array<{ email: string; name: string }>
  _count: { orders: number; devices: number; printers: number }
}

function ShopsTab() {
  const { toast } = useToast()
  const [shops, setShops] = useState<ShopRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', ownerName: '', phone: '', adminEmail: '', adminPassword: '', planCode: 'FREE' })
  const [saving, setSaving] = useState(false)
  const [newCreds, setNewCreds] = useState<{ email: string; password?: string } | null>(null)
  const [del, setDel] = useState<ShopRow | null>(null)
  const [delConfirm, setDelConfirm] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/super/shops?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
    const data = await res.json()
    if (res.ok) setShops(data.shops)
    setLoading(false)
  }, [q])

  useEffect(() => {
    load()
  }, [load])

  async function createShop() {
    setSaving(true)
    try {
      const res = await fetch('/api/super/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: 'Shop created' })
      setNewCreds({ email: form.adminEmail, password: form.adminPassword })
      setCreateOpen(false)
      setForm({ name: '', ownerName: '', phone: '', adminEmail: '', adminPassword: '', planCode: 'FREE' })
      load()
    } catch (err) {
      toast({ title: 'Create failed', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function act(shopId: string, action: string) {
    const res = await fetch(`/api/super/shops/${shopId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      return
    }
    toast({ title: action === 'RESET_PASSWORD' ? `New password: ${data.newPassword}` : `${action.toLowerCase().replace('_', ' ')} done` })
    load()
  }

  async function deleteShop() {
    if (!del) return
    setSaving(true)
    try {
      const res = await fetch(`/api/super/shops/${del.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: delConfirm.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: `Shop ${del.slug} deleted`, description: 'All tenant data and files were removed.' })
      setDel(null)
      setDelConfirm('')
      load()
    } catch (err) {
      toast({ title: 'Delete failed', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Search shops" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-xs" />
        <Button variant="outline" size="sm" onClick={load} aria-label="Refresh"><RefreshCw className="h-4 w-4" aria-hidden /></Button>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" aria-hidden /> Onboard shop</Button>
      </div>

      {loading ? (
        <CenterSpinner />
      ) : (
        <div className="space-y-2">
          {shops.map((s) => (
            <Card key={s.id}>
              <CardContent className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">
                    {s.name} <span className="text-muted-foreground font-normal">· /s/{s.slug}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.users[0]?.email || 'no admin'} · {s.subscription?.plan?.name || 'no plan'} ({s.subscription?.status || '—'})
                    {s.subscription?.expiresAt ? ` until ${new Date(s.subscription.expiresAt).toLocaleDateString('en-IN')}` : ''}
                    {` · ${s._count.orders} orders · ${s._count.devices} devices`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={s.isActive ? 'default' : 'destructive'}>{s.isActive ? 'ACTIVE' : 'SUSPENDED'}</Badge>
                  {s.isActive ? (
                    <Button size="sm" variant="destructive" onClick={() => act(s.id, 'SUSPEND')}><ShieldOff className="h-3.5 w-3.5 mr-1" aria-hidden />Suspend</Button>
                  ) : (
                    <Button size="sm" onClick={() => act(s.id, 'ACTIVATE')}><ShieldCheck className="h-3.5 w-3.5 mr-1" aria-hidden />Activate</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => act(s.id, 'RESET_PASSWORD')}><KeyRound className="h-3.5 w-3.5 mr-1" aria-hidden />Reset pwd</Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" aria-label={`Delete ${s.slug}`} onClick={() => { setDel(s); setDelConfirm('') }}><Trash2 className="h-3.5 w-3.5" aria-hidden /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Onboard a new shop</DialogTitle>
            <DialogDescription>Creates the shop, its ordering URL, owner login and default pricing.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1 col-span-2"><Label>Shop name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Owner name</Label><Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label>Owner login email</Label><Input type="email" value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></div>
            <div className="space-y-1"><Label>Initial password</Label><Input value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} placeholder="min 8 chars" /></div>
            <div className="space-y-1 col-span-2">
              <Label>Plan</Label>
              <Select value={form.planCode} onValueChange={(v) => setForm({ ...form, planCode: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createShop} disabled={saving || !form.name || !form.adminEmail || form.adminPassword.length < 8}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Create shop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newCreds} onOpenChange={(v) => !v && setNewCreds(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Shop created — share these credentials</DialogTitle></DialogHeader>
          <p className="text-sm">Owner login: <strong>{newCreds?.email}</strong><br />Password: <strong>{newCreds?.password}</strong></p>
          <DialogFooter><Button onClick={() => setNewCreds(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!del} onOpenChange={(v) => { if (!v) { setDel(null); setDelConfirm('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete shop {del?.slug}?</DialogTitle>
            <DialogDescription>
              Permanently removes the shop, its owner login, orders, documents, print jobs and uploaded files. This cannot be undone.
              Type the shop slug <strong>{del?.slug}</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} placeholder={del?.slug} aria-label="Confirm shop slug" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDel(null); setDelConfirm('') }}>Cancel</Button>
            <Button variant="destructive" onClick={deleteShop} disabled={saving || delConfirm.trim() !== del?.slug}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface UserRow {
  id: string
  email: string
  name: string
  role: string
  isActive: boolean
  createdAt: string
  shop: { id: string; name: string; slug: string } | null
}

function UsersTab() {
  const { toast } = useToast()
  const [users, setUsers] = useState<UserRow[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [reset, setReset] = useState<UserRow | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/super/users?q=${encodeURIComponent(q)}`, { cache: 'no-store' })
    const data = await res.json()
    if (res.ok) setUsers(data.users)
    setLoading(false)
  }, [q])

  useEffect(() => {
    load()
  }, [load])

  async function submitReset() {
    if (!reset) return
    setSaving(true)
    try {
      const res = await fetch('/api/super/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: reset.id, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: `Password reset for ${reset.email}`, description: 'All their sessions were signed out.' })
      setReset(null)
      setNewPassword('')
    } catch (err) {
      toast({ title: 'Reset failed', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <Input placeholder="Search users by email or name" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-xs" />
        <Button variant="outline" size="sm" onClick={load} aria-label="Refresh"><RefreshCw className="h-4 w-4" aria-hidden /></Button>
      </div>
      {loading ? (
        <CenterSpinner />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id}>
              <CardContent className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm">
                    {u.name} <span className="text-muted-foreground font-normal">· {u.email}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {u.role}{u.shop ? ` · ${u.shop.name} (/s/${u.shop.slug})` : ''} · joined {new Date(u.createdAt).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={u.isActive ? 'default' : 'destructive'}>{u.isActive ? 'ACTIVE' : 'DISABLED'}</Badge>
                  <Button size="sm" variant="outline" onClick={() => { setReset(u); setNewPassword('') }}><KeyRound className="h-3.5 w-3.5 mr-1" aria-hidden />Reset password</Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {users.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No users found.</p>}
        </div>
      )}

      <Dialog open={!!reset} onOpenChange={(v) => !v && setReset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password — {reset?.email}</DialogTitle>
            <DialogDescription>
              Set a new password for this user. They will be signed out everywhere. Minimum 8 characters with a letter and a digit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label>New password</Label>
            <Input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="min 8 chars, 1 letter + 1 digit" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReset(null)}>Cancel</Button>
            <Button onClick={submitReset} disabled={saving || newPassword.length < 8}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface SubPaymentRow {
  id: string
  amountPaise: number
  utr: string
  payerName?: string
  status: string
  createdAt: string
  shop: { name: string; slug: string; phone?: string }
  plan: { name: string; code: string; durationDays: number }
}

function SubsTab() {
  const { toast } = useToast()
  const [payments, setPayments] = useState<SubPaymentRow[]>([])
  const [status, setStatus] = useState('PENDING')
  const [verify, setVerify] = useState<{ p: SubPaymentRow; action: 'VERIFY' | 'REJECT' } | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/super/subpayments?status=${status}`, { cache: 'no-store' })
    const data = await res.json()
    if (res.ok) setPayments(data.payments)
  }, [status])

  useEffect(() => {
    const first = setTimeout(load, 0)
    const t = setInterval(load, 10000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [load])

  async function submit() {
    if (!verify) return
    const res = await fetch(`/api/super/subpayments?id=${verify.p.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: verify.action, note: note || undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      return
    }
    toast({ title: verify.action === 'VERIFY' ? `Subscription activated for ${verify.p.shop.name}` : 'Payment rejected' })
    setVerify(null)
    setNote('')
    load()
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>{['PENDING', 'VERIFIED', 'REJECTED', 'ALL'].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden /></Button>
      </div>
      {payments.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No subscription payments here.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <Card key={p.id}>
              <CardContent className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{p.shop.name} · {p.plan.name} · {formatInr(p.amountPaise)}</p>
                  <p className="text-xs text-muted-foreground">
                    UTR <strong className="text-foreground">{p.utr}</strong>{p.payerName ? ` · ${p.payerName}` : ''} · {new Date(p.createdAt).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={p.status === 'VERIFIED' ? 'default' : p.status === 'PENDING' ? 'secondary' : 'destructive'}>{p.status}</Badge>
                  {p.status === 'PENDING' && (
                    <>
                      <Button size="sm" onClick={() => { setVerify({ p, action: 'VERIFY' }); setNote('') }}><Check className="h-4 w-4 mr-1" aria-hidden />Verify</Button>
                      <Button size="sm" variant="destructive" onClick={() => { setVerify({ p, action: 'REJECT' }); setNote('') }}><X className="h-4 w-4 mr-1" aria-hidden />Reject</Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={!!verify} onOpenChange={(v) => !v && setVerify(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{verify?.action === 'VERIFY' ? 'Verify subscription payment' : 'Reject payment'}</DialogTitle>
            <DialogDescription>
              {verify?.p.shop.name} · {verify?.p.plan.name} ({verify?.p.plan.durationDays} days) · UTR {verify?.p.utr}. Confirm the money arrived in the
              platform UPI account before verifying.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1"><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerify(null)}>Cancel</Button>
            <Button variant={verify?.action === 'VERIFY' ? 'default' : 'destructive'} onClick={submit}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface PlanRow { id: string; code: string; name: string; pricePaise: number; durationDays: number; maxOrdersMonth: number | null; maxDevices: number | null; isActive: boolean }

function PlansTab() {
  const { toast } = useToast()
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/super/plans', { cache: 'no-store' })
    const data = await res.json()
    if (res.ok) setPlans(data.plans)
  }, [])

  useEffect(() => { load() }, [load])

  async function save(p: PlanRow, patch: Partial<PlanRow>) {
    setSavingId(p.id)
    try {
      const res = await fetch(`/api/super/plans?id=${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: 'Plan updated' })
      load()
    } catch (err) {
      toast({ title: 'Failed', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-3">
      {plans.map((p) => (
        <Card key={p.id}>
          <CardContent className="py-3 grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div className="col-span-2 md:col-span-1">
              <p className="font-semibold text-sm">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.code}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Price ₹</Label>
              <Input
                type="number"
                defaultValue={(p.pricePaise / 100).toFixed(0)}
                onBlur={(e) => {
                  const v = Math.round(Number(e.target.value) * 100)
                  if (v !== p.pricePaise) save(p, { pricePaise: v })
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Duration (days)</Label>
              <Input type="number" defaultValue={p.durationDays} onBlur={(e) => { const v = Number(e.target.value); if (v !== p.durationDays) save(p, { durationDays: v }) }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max orders/month</Label>
              <Input type="number" defaultValue={p.maxOrdersMonth ?? ''} placeholder="unlimited" onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== p.maxOrdersMonth) save(p, { maxOrdersMonth: v }) }} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Max printers</Label>
              <Input type="number" defaultValue={p.maxDevices ?? ''} placeholder="unlimited" onBlur={(e) => { const v = e.target.value ? Number(e.target.value) : null; if (v !== p.maxDevices) save(p, { maxDevices: v }) }} />
            </div>
            <div className="flex items-center gap-2">
              {savingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              <Button size="sm" variant={p.isActive ? 'default' : 'outline'} onClick={() => save(p, { isActive: !p.isActive })}>
                {p.isActive ? 'Active' : 'Inactive'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

interface AuditRow {
  id: string
  action: string
  actorType: string
  entity?: string
  entityId?: string
  ip?: string
  createdAt: string
  user?: { email: string }
  shop?: { name: string }
  metaJson?: string
}

function AuditTab() {
  const [logs, setLogs] = useState<AuditRow[]>([])
  const [action, setAction] = useState('')

  useEffect(() => {
    fetch(`/api/super/audit?action=${encodeURIComponent(action)}`, { cache: 'no-store' }).then((r) => r.json()).then((d) => d.logs && setLogs(d.logs))
  }, [action])

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Platform audit log</CardTitle>
        <CardDescription>Latest {logs.length} entries — filter by action keyword.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Input placeholder="Filter e.g. PAYMENT, DEVICE, LOGIN" value={action} onChange={(e) => setAction(e.target.value)} className="w-full sm:max-w-sm" />
        <div className="max-h-[60vh] overflow-auto rounded border">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left p-2">Time</th>
                <th className="text-left p-2">Action</th>
                <th className="text-left p-2">Actor</th>
                <th className="text-left p-2">Shop</th>
                <th className="text-left p-2">IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                  <td className="p-2 font-medium">{l.action}</td>
                  <td className="p-2">{l.actorType}{l.user ? ` · ${l.user.email}` : ''}</td>
                  <td className="p-2">{l.shop?.name || '—'}</td>
                  <td className="p-2">{l.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function PlatformSettingsTab() {
  const { toast } = useToast()
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/super/settings', { cache: 'no-store' }).then((r) => r.json()).then((d) => d.settings && setForm(d.settings))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      for (const [key, value] of Object.entries(form)) {
        await fetch('/api/super/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) })
      }
      toast({ title: 'Platform settings saved' })
    } finally {
      setSaving(false)
    }
  }

  const fields: Array<{ key: string; label: string; hint?: string }> = [
    { key: 'platform_name', label: 'Platform name' },
    {
      key: 'super_admin_upi_vpa',
      label: 'Platform UPI ID (subscription payments)',
      hint: 'Every shop-owner plan payment is collected in this UPI account. Owners see it as text + a scan-to-pay QR in their dashboard.',
    },
    { key: 'super_admin_payee_name', label: 'Platform payee name' },
    { key: 'support_phone', label: 'Support phone' },
    { key: 'order_prefix', label: 'Order number prefix' },
  ]

  return (
    <Card className="max-w-xl">
      <CardHeader className="pb-2"><CardTitle className="text-base">Platform settings</CardTitle></CardHeader>
      <CardContent>
        {!form.super_admin_upi_vpa && (
          <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 text-sm">
            Set your UPI ID below — until then shop owners cannot pay for plans.
          </p>
        )}
        <form onSubmit={save} className="space-y-3">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label>{f.label}</Label>
              <Input value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
          <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Save settings</Button>
        </form>
      </CardContent>
    </Card>
  )
}
