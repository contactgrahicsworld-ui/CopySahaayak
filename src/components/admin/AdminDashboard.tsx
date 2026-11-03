'use client'

// Shop Admin dashboard: Overview · Orders · Payments · Printers & Devices ·
// Pricing · Reports · Settings. Every action hits the tenant-scoped API.
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog'
import { useToast } from '@/hooks/use-toast'
import { formatInr } from '@/lib/constants'
import {
  LayoutDashboard, ClipboardList, BadgeCheck, Printer, IndianRupee, BarChart3, Settings, LogOut,
  RefreshCw, FileText, Plus, QrCode, Loader2, Check, X, Store, KeyRound, MessageCircle,
} from 'lucide-react'

// wa.me deep link: works on every phone/WhatsApp Web with no API approval needed.
// Normalises Indian numbers (10-digit → 91…, leading 0 → 91…).
function whatsappUrl(phone: string | null | undefined, text: string): string {
  const digits = (phone || '').replace(/\D/g, '')
  const intl = digits.length === 10 ? `91${digits}` : digits.length === 11 && digits.startsWith('0') ? `91${digits.slice(1)}` : digits
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`
}

function orderWhatsappText(o: { orderNumber: string; status: string; totalPaise: number }): string {
  const amt = `Rs.${(o.totalPaise / 100).toFixed(2)}`
  const hi: Record<string, string> = {
    PENDING_PAYMENT: `Aapka order ${o.orderNumber} (${amt}) ban gaya hai — UPI payment karke UTR darj karein.`,
    AWAITING_VERIFICATION: `Order ${o.orderNumber} (${amt}) ki payment verify ho rahi hai. Dhanyavaad!`,
    CONFIRMED: `Order ${o.orderNumber} confirm ho gaya hai (${amt}) — printing shuru.`,
    COMPLETED: `Order ${o.orderNumber} print ho kar taiyar hai (${amt}) — kripya dukaan se collect karein.`,
    REJECTED: `Order ${o.orderNumber} reject ho gaya hai. Kripya dukaan sampark karein.`,
    CANCELLED: `Order ${o.orderNumber} rad kar diya gaya hai.`,
  }
  return hi[o.status] || `Order ${o.orderNumber} ka status update.`
}

interface UserProp { name: string; email: string }
interface ShopProp { id: string; name: string; slug: string }

export function AdminDashboard({ user, shop }: { user: UserProp; shop: ShopProp }) {
  const { toast } = useToast()
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
        <div className="container mx-auto px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Store className="h-5 w-5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">{shop.name}</p>
              <p className="text-[11px] text-muted-foreground truncate">{user.email} · /s/{shop.slug}</p>
            </div>
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
            <TabsTrigger value="orders" className="shrink-0"><ClipboardList className="h-4 w-4 mr-1" aria-hidden /> Orders</TabsTrigger>
            <TabsTrigger value="payments" className="shrink-0"><BadgeCheck className="h-4 w-4 mr-1" aria-hidden /> Payments</TabsTrigger>
            <TabsTrigger value="printers" className="shrink-0"><Printer className="h-4 w-4 mr-1" aria-hidden /> Printers</TabsTrigger>
            <TabsTrigger value="pricing" className="shrink-0"><IndianRupee className="h-4 w-4 mr-1" aria-hidden /> Pricing</TabsTrigger>
            <TabsTrigger value="reports" className="shrink-0"><BarChart3 className="h-4 w-4 mr-1" aria-hidden /> Reports</TabsTrigger>
            <TabsTrigger value="settings" className="shrink-0"><Settings className="h-4 w-4 mr-1" aria-hidden /> Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><OverviewTab onGoTo={setTab} /></TabsContent>
          <TabsContent value="orders"><OrdersTab /></TabsContent>
          <TabsContent value="payments"><PaymentsTab /></TabsContent>
          <TabsContent value="printers"><PrintersTab /></TabsContent>
          <TabsContent value="pricing"><PricingTab /></TabsContent>
          <TabsContent value="reports"><ReportsTab /></TabsContent>
          <TabsContent value="settings"><SettingsTab shop={shop} /></TabsContent>
        </Tabs>
      </div>

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </main>
  )
}

// ---------- Overview ----------
function OverviewTab({ onGoTo }: { onGoTo: (t: string) => void }) {
  const [stats, setStats] = useState<{
    orders: { pendingOrders: number; awaitingVerification: number; confirmed: number; completedToday: number; activeJobs: number }
    revenue: { todayPaise: number; monthPaise: number }
    printers: { online: number; total: number }
    subscription: { status: string; expiresAt: string | null; plan: { name: string } } | null
  } | null>(null)

  useEffect(() => {
    const load = () => fetch('/api/admin/dashboard', { cache: 'no-store' }).then((r) => r.json()).then(setStats).catch(() => {})
    load()
    const t = setInterval(load, 15000)
    return () => clearInterval(t)
  }, [])

  if (!stats) return <CenterSpinner />
  const s = stats
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Awaiting payment verification" value={String(s.orders.awaitingVerification)} highlight={s.orders.awaitingVerification > 0} onClick={() => onGoTo('payments')} />
        <StatCard label="Confirmed / in print queue" value={String(s.orders.confirmed)} />
        <StatCard label="Printed today" value={String(s.orders.completedToday)} />
        <StatCard label="Revenue today" value={formatInr(s.revenue.todayPaise)} />
        <StatCard label="Revenue this month" value={formatInr(s.revenue.monthPaise)} />
        <StatCard label="Printers online" value={`${s.printers.online}/${s.printers.total}`} onClick={() => onGoTo('printers')} />
        <StatCard label="Jobs in queue" value={String(s.orders.activeJobs)} />
        <StatCard label="Pending payments" value={String(s.orders.pendingOrders)} />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Subscription</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {s.subscription ? (
            <>
              Plan <strong className="text-foreground">{s.subscription.plan?.name}</strong> · status {s.subscription.status}
              {s.subscription.expiresAt && <> · valid until {new Date(s.subscription.expiresAt).toLocaleDateString('en-IN')}</>}
              {' — renewals are verified by the platform admin from the '}
              <button className="underline" onClick={() => onGoTo('settings')}>Settings tab</button>.
            </>
          ) : (
            'No subscription found — contact platform admin.'
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatCard({ label, value, highlight, onClick }: { label: string; value: string; highlight?: boolean; onClick?: () => void }) {
  return (
    <Card className={onClick ? 'cursor-pointer hover:bg-accent/50 transition-colors' : ''} onClick={onClick}>
      <CardContent className="pt-4 pb-3">
        <p className={`text-2xl font-bold ${highlight ? 'text-amber-600' : ''}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  )
}

function CenterSpinner() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
    </div>
  )
}

// ---------- Orders ----------
interface OrderRow {
  id: string
  orderNumber: string
  status: string
  totalPaise: number
  customerName?: string
  customerPhone?: string
  createdAt: string
  payment?: { status: string; utr?: string; rejectionReason?: string }
  items: Array<{ id: string; colorMode: string; paperSize: string; copies: number; duplex: boolean; pageCount: number; totalPaise: number; document: { id: string; originalName: string } }>
  printJobs: Array<{ id: string; status: string }>
}

const ORDER_STATUS_STYLES: Record<string, string> = {
  PENDING_PAYMENT: 'bg-muted text-muted-foreground',
  AWAITING_VERIFICATION: 'bg-amber-100 text-amber-900',
  CONFIRMED: 'bg-sky-100 text-sky-900',
  COMPLETED: 'bg-green-100 text-green-900',
  CANCELLED: 'bg-red-100 text-red-900',
  REJECTED: 'bg-red-100 text-red-900',
}

function OrdersTab() {
  const { toast } = useToast()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [filter, setFilter] = useState('ALL')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [previewDoc, setPreviewDoc] = useState<{ id: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orders?status=${filter}&q=${encodeURIComponent(q)}`, { cache: 'no-store' })
      const data = await res.json()
      if (res.ok) setOrders(data.orders)
    } finally {
      setLoading(false)
    }
  }, [filter, q])

  useEffect(() => {
    load()
    const t = setInterval(load, 12000)
    return () => clearInterval(t)
  }, [load])

  async function act(orderId: string, action: string) {
    const res = await fetch(`/api/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Action failed', description: data.error, variant: 'destructive' })
      return
    }
    toast({ title: `Order ${action.toLowerCase().replace('_', ' ')} done` })
    load()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['ALL', 'PENDING_PAYMENT', 'AWAITING_VERIFICATION', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED'].map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input placeholder="Search order no / name / phone" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:max-w-xs" />
        <Button variant="outline" size="sm" onClick={load} aria-label="Refresh"><RefreshCw className="h-4 w-4" aria-hidden /></Button>
      </div>

      {loading && orders.length === 0 ? (
        <CenterSpinner />
      ) : orders.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No orders match this filter.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Card key={o.id}>
              <CardContent className="py-3 space-y-2">
                <button className="w-full text-left" onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{o.orderNumber}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(o.createdAt).toLocaleString('en-IN')}
                        {o.customerName ? ` · ${o.customerName}` : ''}
                        {o.customerPhone ? ` · ${o.customerPhone}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{formatInr(o.totalPaise)}</span>
                      <Badge className={ORDER_STATUS_STYLES[o.status] || ''}>{o.status.replace(/_/g, ' ')}</Badge>
                    </div>
                  </div>
                </button>

                {openId === o.id && (
                  <div className="border-t pt-2 space-y-2 text-sm">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          <button className="underline truncate" onClick={() => setPreviewDoc({ id: it.document.id, name: it.document.originalName })}>
                            {it.document.originalName}
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {it.colorMode === 'BW' ? 'B/W' : 'Colour'} · {it.paperSize} · {it.pageCount} sides × {it.copies}{it.duplex ? ' · duplex' : ''}
                          </span>
                        </span>
                        <span className="font-medium">{formatInr(it.totalPaise)}</span>
                      </div>
                    ))}
                    {o.payment?.utr && <p className="text-xs text-muted-foreground">UTR: {o.payment.utr} · payment {o.payment.status}</p>}
                    {o.printJobs.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Print jobs: {o.printJobs.map((j) => j.status).join(', ')}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {o.customerPhone && (
                        <Button size="sm" variant="outline" onClick={() => window.open(whatsappUrl(o.customerPhone, orderWhatsappText(o)), '_blank')}>
                          <MessageCircle className="h-4 w-4 mr-1" aria-hidden />WhatsApp update
                        </Button>
                      )}
                      {o.status === 'CONFIRMED' && (
                        <Button size="sm" variant="outline" onClick={() => act(o.id, 'COMPLETE')}>Mark printed & completed</Button>
                      )}
                      {(o.status === 'CONFIRMED' || o.status === 'COMPLETED') && o.printJobs.some((j) => j.status === 'FAILED') && (
                        <Button size="sm" variant="outline" onClick={() => act(o.id, 'REQUEUE_JOBS')}>Retry failed print jobs</Button>
                      )}
                      {['PENDING_PAYMENT', 'AWAITING_VERIFICATION', 'CONFIRMED'].includes(o.status) && (
                        <Button size="sm" variant="destructive" onClick={() => act(o.id, 'CANCEL')}>Cancel order</Button>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!previewDoc} onOpenChange={(v) => !v && setPreviewDoc(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm pr-6 break-all">{previewDoc?.name}</DialogTitle>
          </DialogHeader>
          {previewDoc && (
            <iframe src={`/api/admin/file/${previewDoc.id}`} className="w-full h-[60vh] sm:h-[70vh] rounded-md border" title={`Preview of ${previewDoc.name}`} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------- Payments ----------
interface PaymentRow {
  id: string
  status: string
  amountPaise: number
  utr?: string
  payerName?: string
  rejectionReason?: string
  submittedAt?: string
  order: { orderNumber: string; totalPaise: number; customerName?: string; customerPhone?: string }
}

function PaymentsTab() {
  const { toast } = useToast()
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [status, setStatus] = useState('SUBMITTED')
  const [verify, setVerify] = useState<{ p: PaymentRow; action: 'VERIFY' | 'REJECT' } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/payments?status=${status}`, { cache: 'no-store' })
    const data = await res.json()
    if (res.ok) setPayments(data.payments)
  }, [status])

  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])

  async function submit() {
    if (!verify) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/payments/${verify.p.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: verify.action, note: note || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: verify.action === 'VERIFY' ? 'Payment verified — job queued to printers' : 'Payment rejected' })
      setVerify(null)
      setNote('')
      load()
    } catch (err) {
      toast({ title: 'Failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['SUBMITTED', 'VERIFIED', 'REJECTED', 'PENDING', 'ALL'].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden /></Button>
      </div>

      {payments.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Nothing here. Customer UTR submissions will appear for verification.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <Card key={p.id}>
              <CardContent className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{p.order.orderNumber} · {formatInr(p.amountPaise)}</p>
                  <p className="text-xs text-muted-foreground">
                    UTR: <strong className="text-foreground">{p.utr || '—'}</strong>
                    {p.payerName ? ` · ${p.payerName}` : ''}
                    {p.submittedAt ? ` · ${new Date(p.submittedAt).toLocaleString('en-IN')}` : ''}
                  </p>
                  {p.rejectionReason && <p className="text-xs text-red-600">{p.rejectionReason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={ORDER_STATUS_STYLES[p.status] || ''}>{p.status}</Badge>
                  {p.status === 'SUBMITTED' && (
                    <>
                      <Button size="sm" onClick={() => { setVerify({ p, action: 'VERIFY' }); setNote('') }}>
                        <Check className="h-4 w-4 mr-1" aria-hidden /> Verify
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => { setVerify({ p, action: 'REJECT' }); setNote('') }}>
                        <X className="h-4 w-4 mr-1" aria-hidden /> Reject
                      </Button>
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
            <DialogTitle>{verify?.action === 'VERIFY' ? 'Verify payment' : 'Reject payment'}</DialogTitle>
            <DialogDescription>
              {verify?.p.order.orderNumber} · {verify ? formatInr(verify.p.amountPaise) : ''} · UTR {verify?.p.utr}.
              {verify?.action === 'VERIFY'
                ? ' Confirm the amount actually arrived in your bank/UPI app before verifying. Verifying queues the print jobs.'
                : ' Rejecting informs the customer. They can place the order again.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vnote" className="text-sm">Note (optional)</Label>
            <Input id="vnote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. amount mismatch" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVerify(null)}>Cancel</Button>
            <Button variant={verify?.action === 'VERIFY' ? 'default' : 'destructive'} onClick={submit} disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}
              Confirm {verify?.action === 'VERIFY' ? 'verify' : 'reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------- Printers & Devices ----------
interface DeviceRow {
  id: string
  name: string
  machineName?: string
  status: string
  lastSeenAt?: string
  appVersion?: string
  printers: Array<{ id: string; windowsName: string; colorMode: string; status: string }>
}
interface PrinterRow {
  id: string
  windowsName: string
  displayName?: string
  colorMode: string
  isDefault: boolean
  status: string
  lastSeenAt?: string
}

function PrintersTab() {
  const { toast } = useToast()
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [printers, setPrinters] = useState<PrinterRow[]>([])
  const [pairing, setPairing] = useState<{ code: string; deepLink: string; expiresAt: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [d, p] = await Promise.all([
      fetch('/api/admin/devices', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/admin/printers', { cache: 'no-store' }).then((r) => r.json()),
    ])
    if (d.devices) setDevices(d.devices)
    if (p.printers) setPrinters(p.printers)
    setLoading(false)
  }, [])

  useEffect(() => {
    const first = setTimeout(load, 0)
    const t = setInterval(load, 10000)
    return () => {
      clearTimeout(first)
      clearInterval(t)
    }
  }, [load])

  async function createPairing() {
    const res = await fetch('/api/admin/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Could not create pairing code', description: data.error, variant: 'destructive' })
      return
    }
    setPairing({ code: data.device.pairingCode, deepLink: data.deepLink, expiresAt: data.device.expiresAt })
    load()
  }

  async function revokeDevice(id: string) {
    const res = await fetch(`/api/admin/devices/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Device revoked — its token no longer works' })
    load()
  }

  async function updatePrinter(id: string, patch: Record<string, unknown>) {
    const res = await fetch('/api/admin/printers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    const data = await res.json()
    if (!res.ok) toast({ title: 'Failed', description: data.error, variant: 'destructive' })
    else load()
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2 flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">Windows connectors</CardTitle>
            <CardDescription>One connector per shop PC. Pair with a 6-character code.</CardDescription>
          </div>
          <Button size="sm" className="shrink-0" onClick={createPairing}><Plus className="h-4 w-4 mr-1" aria-hidden /> Pair connector</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <CenterSpinner />
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No connector paired yet. Click “Pair connector”, then enter the code in the Windows app
              (download from the <a href="/download" className="underline">connector page</a>).
            </p>
          ) : (
            devices.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3">
                <div>
                  <p className="text-sm font-medium">{d.name} <span className="text-muted-foreground">({d.machineName || 'unknown PC'})</span></p>
                  <p className="text-xs text-muted-foreground">
                    v{d.appVersion || '?'} · last seen {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('en-IN') : 'never'} · {d.printers.length} printer(s)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={d.status === 'ACTIVE' ? 'default' : d.status === 'PENDING' ? 'secondary' : 'destructive'}>{d.status}</Badge>
                  {d.status !== 'REVOKED' && (
                    <Button size="sm" variant="destructive" onClick={() => revokeDevice(d.id)}>Revoke</Button>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Printers (auto-registered by connectors)</CardTitle>
          <CardDescription>Tag each printer as B/W or Colour. Verified jobs are routed by colour.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {printers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Printers appear here after a connector pairs and heartbeats.</p>
          ) : (
            printers.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.displayName || p.windowsName}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.status} · last seen {p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString('en-IN') : 'never'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={p.colorMode} onValueChange={(v) => updatePrinter(p.id, { colorMode: v })}>
                    <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BW">Black & White</SelectItem>
                      <SelectItem value="COLOR">Colour</SelectItem>
                      <SelectItem value="ANY">Any</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button size="sm" variant={p.isDefault ? 'default' : 'outline'} onClick={() => updatePrinter(p.id, { isDefault: true })}>
                    {p.isDefault ? 'Default' : 'Set default'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!pairing} onOpenChange={(v) => !v && setPairing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><QrCode className="h-4 w-4" aria-hidden /> Pair a Windows connector</DialogTitle>
            <DialogDescription>
              Enter this code in the connector window on the shop PC within 15 minutes. On the same PC? Open the deep link.
            </DialogDescription>
          </DialogHeader>
          <div className="text-center space-y-3 py-2">
            <p className="text-3xl sm:text-4xl font-mono font-bold tracking-widest">{pairing?.code}</p>
            <p className="text-xs text-muted-foreground">Expires {pairing ? new Date(pairing.expiresAt).toLocaleTimeString('en-IN') : ''}</p>
            <a href={pairing?.deepLink} className="text-xs underline break-all">{pairing?.deepLink}</a>
          </div>
          <DialogFooter><Button onClick={() => setPairing(null)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------- Pricing ----------
interface PricingRuleRow { id: string; paperSize: string; colorMode: string; singleSidedPaise: number; duplexPaise: number }

function PricingTab() {
  const { toast } = useToast()
  const [rules, setRules] = useState<PricingRuleRow[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/admin/pricing', { cache: 'no-store' }).then((r) => r.json()).then((d) => d.rules && setRules(d.rules))
  }, [])

  function setRule(ps: string, cm: string, field: 'singleSidedPaise' | 'duplexPaise', rupees: string) {
    const paise = Math.round(Number(rupees || 0) * 100)
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.paperSize === ps && r.colorMode === cm)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], [field]: paise }
        return next
      }
      return [...prev, { id: `new-${ps}-${cm}`, paperSize: ps, colorMode: cm, singleSidedPaise: field === 'singleSidedPaise' ? paise : 0, duplexPaise: field === 'duplexPaise' ? paise : 0 }]
    })
  }

  function getRule(ps: string, cm: string) {
    return rules.find((r) => r.paperSize === ps && r.colorMode === cm)
  }

  async function save() {
    setSaving(true)
    try {
      const payload = rules
        .filter((r) => r.singleSidedPaise > 0)
        .map((r) => ({ paperSize: r.paperSize, colorMode: r.colorMode, singleSidedPaise: r.singleSidedPaise, duplexPaise: Math.min(r.duplexPaise, r.singleSidedPaise) }))
      const res = await fetch('/api/admin/pricing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: payload }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: 'Pricing saved — customers see new rates immediately' })
      if (data.rules) setRules(data.rules)
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Rates per printed side (₹)</CardTitle>
        <CardDescription>Leave a rate at 0 to disable that combination. The server always computes the final bill.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Size</TableHead>
              <TableHead>Colour mode</TableHead>
              <TableHead>Single-sided ₹/side</TableHead>
              <TableHead>Duplex ₹/side</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {['A4', 'A3', 'A5', 'LEGAL'].flatMap((ps) =>
              ['BW', 'COLOR'].map((cm) => {
                const r = getRule(ps, cm)
                return (
                  <TableRow key={`${ps}-${cm}`}>
                    <TableCell className="font-medium">{ps}</TableCell>
                    <TableCell>{cm === 'BW' ? 'Black & White' : 'Colour'}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        className="w-24"
                        value={r ? (r.singleSidedPaise / 100).toFixed(2) : ''}
                        onChange={(e) => setRule(ps, cm, 'singleSidedPaise', e.target.value)}
                        aria-label={`${ps} ${cm} single sided price`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.05"
                        min="0"
                        className="w-24"
                        value={r ? (r.duplexPaise / 100).toFixed(2) : ''}
                        onChange={(e) => setRule(ps, cm, 'duplexPaise', e.target.value)}
                        aria-label={`${ps} ${cm} duplex price`}
                      />
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
        <Button className="mt-4" onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Save pricing
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------- Reports ----------
function ReportsTab() {
  const [data, setData] = useState<{
    daily: Array<{ date: string; revenuePaise: number; orders: number }>
    summary: { totalRevenuePaise: number; totalOrders: number; bwSides: number; colorSides: number; bwRevenuePaise: number; colorRevenuePaise: number }
  } | null>(null)
  const [days, setDays] = useState('30')

  useEffect(() => {
    fetch(`/api/admin/reports?days=${days}`, { cache: 'no-store' }).then((r) => r.json()).then(setData)
  }, [days])

  if (!data) return <CenterSpinner />
  const max = Math.max(1, ...data.daily.map((d) => d.revenuePaise))
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['7', '14', '30', '90'].map((d) => (
              <SelectItem key={d} value={d}>Last {d} days</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Revenue" value={formatInr(data.summary.totalRevenuePaise)} />
        <StatCard label="Paid orders" value={String(data.summary.totalOrders)} />
        <StatCard label="B/W sides printed" value={String(data.summary.bwSides)} />
        <StatCard label="Colour sides printed" value={String(data.summary.colorSides)} />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Revenue by day</CardTitle></CardHeader>
        <CardContent>
          {data.daily.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No confirmed orders in this period yet.</p>
          ) : (
            <div className="space-y-1.5">
              {data.daily.map((d) => (
                <div key={d.date} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground">{d.date.slice(5)}</span>
                  <div className="h-4 rounded bg-primary/70" style={{ width: `${(d.revenuePaise / max) * 70}%` }} />
                  <span className="font-medium">{formatInr(d.revenuePaise)}</span>
                  <span className="text-muted-foreground">({d.orders})</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Settings ----------
function SettingsTab({ shop }: { shop: ShopProp }) {
  const { toast } = useToast()
  const [form, setForm] = useState({ name: '', ownerName: '', phone: '', address: '', whatsappNumber: '', upiVpa: '', upiPayeeName: '' })
  const [logoName, setLogoName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sub, setSub] = useState<{
    subscription: { status: string; expiresAt: string | null; plan: { name: string; pricePaise: number } } | null
    plans: Array<{ code: string; name: string; pricePaise: number; durationDays: number; features: string[] }>
    superAdminUpi: string
    superAdminPayee: string
  } | null>(null)
  const [payPlan, setPayPlan] = useState<{ code: string; name: string; pricePaise: number } | null>(null)
  const [utr, setUtr] = useState('')
  const [payerName, setPayerName] = useState('')

  useEffect(() => {
    fetch('/api/admin/shop', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      if (d.shop) {
        setForm({
          name: d.shop.name || '',
          ownerName: d.shop.ownerName || '',
          phone: d.shop.phone || '',
          address: d.shop.address || '',
          whatsappNumber: d.shop.whatsappNumber || '',
          upiVpa: d.shop.upiVpa || '',
          upiPayeeName: d.shop.upiPayeeName || '',
        })
      }
    })
    fetch('/api/admin/subscription', { cache: 'no-store' }).then((r) => r.json()).then(setSub)
  }, [])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const fd = new FormData()
    Object.entries(form).forEach(([k, v]) => fd.append(k, v))
    const logoInput = document.getElementById('logo-input') as HTMLInputElement | null
    if (logoInput?.files?.[0]) fd.append('logo', logoInput.files[0])
    try {
      const res = await fetch('/api/admin/shop', { method: 'PATCH', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast({ title: 'Shop profile saved' })
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function submitSubPayment() {
    if (!payPlan) return
    if (!/^[a-zA-Z0-9]{8,22}$/.test(utr.trim())) {
      toast({ title: 'Enter the UTR from your subscription payment', variant: 'destructive' })
      return
    }
    const res = await fetch('/api/admin/subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planCode: payPlan.code, utr: utr.trim(), payerName: payerName || undefined }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Submitted — platform admin will verify and activate' })
    setPayPlan(null)
    setUtr('')
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Shop profile</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Shop name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="space-y-1"><Label>Owner name</Label><Input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label>WhatsApp number (order status updates)</Label><Input value={form.whatsappNumber} onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })} inputMode="tel" placeholder="98765 43210" /></div>
            <div className="space-y-1"><Label>UPI ID (VPA)</Label><Input value={form.upiVpa} onChange={(e) => setForm({ ...form, upiVpa: e.target.value })} placeholder="shop@okhdfcbank" /></div>
            <div className="space-y-1"><Label>UPI payee name (shown in apps)</Label><Input value={form.upiPayeeName} onChange={(e) => setForm({ ...form, upiPayeeName: e.target.value })} /></div>
            <div className="space-y-1"><Label>Logo (PNG/JPEG, ≤2 MB)</Label><Input id="logo-input" type="file" accept="image/png,image/jpeg" /></div>
            <div className="space-y-1 md:col-span-2"><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Save profile</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Subscription</CardTitle>
          <CardDescription>
            Your customer ordering URL: <strong>/s/{shop.slug}</strong> — print this as your shop QR.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sub?.subscription && (
            <p className="text-sm">
              Current: <strong>{sub.subscription.plan?.name}</strong> · {sub.subscription.status}
              {sub.subscription.expiresAt ? ` · until ${new Date(sub.subscription.expiresAt).toLocaleDateString('en-IN')}` : ''}
            </p>
          )}
          {sub?.superAdminUpi && (
            <p className="text-sm text-muted-foreground">Pay to platform UPI: <strong className="text-foreground">{sub.superAdminUpi}</strong> ({sub.superAdminPayee})</p>
          )}
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2">
            {sub?.plans.filter((p) => p.pricePaise > 0).map((p) => (
              <Card key={p.code}>
                <CardContent className="pt-4">
                  <p className="font-semibold">{p.name}</p>
                  <p className="text-lg font-bold">₹{(p.pricePaise / 100).toFixed(0)}<span className="text-xs font-normal text-muted-foreground"> / {p.durationDays}d</span></p>
                  <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    {p.features.slice(0, 3).map((f) => <li key={f}>{f}</li>)}
                  </ul>
                  <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setPayPlan(p)}>Renew / upgrade</Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!payPlan} onOpenChange={(v) => !v && setPayPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pay for {payPlan?.name}</DialogTitle>
            <DialogDescription>
              Amount ₹{payPlan ? (payPlan.pricePaise / 100).toFixed(0) : ''} — pay to {sub?.superAdminUpi} from any UPI app, then enter the UTR here.
              The platform admin verifies it before your plan activates.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="space-y-1"><Label>UTR / reference</Label><Input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} /></div>
            <div className="space-y-1"><Label>Payer name (optional)</Label><Input value={payerName} onChange={(e) => setPayerName(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayPlan(null)}>Cancel</Button>
            <Button onClick={submitSubPayment}>Submit for verification</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
