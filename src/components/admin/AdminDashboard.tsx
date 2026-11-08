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
import { ChangeEmailDialog } from '@/components/ChangeEmailDialog'
import { PlanClock } from '@/components/admin/PlanClock'
import { useToast } from '@/hooks/use-toast'
import { formatInr } from '@/lib/constants'
import {
  LayoutDashboard, ClipboardList, BadgeCheck, Printer, IndianRupee, BarChart3, Settings, LogOut,
  RefreshCw, FileText, Plus, QrCode, Loader2, Check, X, Store, KeyRound, MessageCircle, Download,
  TriangleAlert, AtSign, ShieldCheck,
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

export function AdminDashboard({ user, shop, notice }: { user: UserProp; shop: ShopProp; notice?: 'super-only' }) {
  const { toast } = useToast()
  const router = useRouter()
  const [tab, setTab] = useState('overview')
  const [pwOpen, setPwOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [selfEmail, setSelfEmail] = useState(user.email)
  const [superNoticeOpen, setSuperNoticeOpen] = useState(notice === 'super-only')
  // Live plan clock: plan name + expiry fed by the subscription API.
  const [planInfo, setPlanInfo] = useState<{ planName: string; status: string; expiresAt: string | null } | null>(null)
  // White-label: the shop's own name is the app name everywhere (tab title too).
  useEffect(() => { document.title = `${shop.name} — Dashboard` }, [shop.name])
  // Plan expiry watch: warn from 7 days before the subscription ends.
  const [expiry, setExpiry] = useState<{ planName: string; expiresAt: string; daysLeft: number } | null>(null)
  useEffect(() => {
    fetch('/api/admin/subscription', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
      const sub = d?.subscription
      if (!sub) return
      setPlanInfo({ planName: sub.plan?.name || 'Plan', status: sub.status || 'ACTIVE', expiresAt: sub.expiresAt || null })
      if (!sub?.expiresAt || !['ACTIVE', 'PENDING_VERIFICATION'].includes(sub.status)) return
      const ms = new Date(sub.expiresAt).getTime() - Date.now()
      const daysLeft = Math.ceil(ms / 86400000)
      if (daysLeft <= 7) setExpiry({ planName: sub.plan?.name || 'Current plan', expiresAt: sub.expiresAt, daysLeft })
    }).catch(() => {})
    // Refresh the clock data every minute so renewals reflect without a reload.
    const t = setInterval(() => {
      fetch('/api/admin/subscription', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
        const sub = d?.subscription
        if (!sub) return
        setPlanInfo({ planName: sub.plan?.name || 'Plan', status: sub.status || 'ACTIVE', expiresAt: sub.expiresAt || null })
      }).catch(() => {})
    }, 60000)
    return () => clearInterval(t)
  }, [])

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
              <p className="font-semibold text-sm truncate">
                {shop.name}
                <Badge variant="secondary" className="ml-2 align-middle text-[10px] font-medium">Dukaan Owner</Badge>
              </p>
              <p className="text-[11px] text-muted-foreground truncate">{selfEmail} · /s/{shop.slug}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setEmailOpen(true)} aria-label="Change login email">
              <AtSign className="h-4 w-4 sm:mr-1" aria-hidden /> <span className="hidden sm:inline">Email</span>
            </Button>
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
        {planInfo && <PlanClock planName={planInfo.planName} status={planInfo.status} expiresAt={planInfo.expiresAt} />}
        {superNoticeOpen && (
          <div role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <div className="flex-1 space-y-1">
                <p className="font-semibold">Ye aapka <span className="underline">dukaan ka dashboard</span> hai ({shop.name}) — Super Admin dashboard nahi.</p>
                <p>
                  Aap <b>{selfEmail}</b> (Dukaan Owner) se signed in hain. Platform ka <b>Super Admin panel</b> ek
                  alag account se khulta hai — wahi jo aapne sabse pehle platform setup ke waqt banaya tha
                  (uska email/password is dukaan account se different hai). Security ke liye Super Admin dukaan ka
                  orders/customers data nahi dekh sakta, isliye dono accounts alag hain.
                </p>
                <p className="text-xs">
                  Super Admin panel kholne ke liye: pehle <b>Sign out</b> karein → home page par <b>“Super Admin”</b> button
                  par click karein (ya seedha <b>/super/login</b> kholein) → apne Super Admin account se sign in karein.
                  Agar Super Admin account ka password yaad nahi, to us login page par
                  <b> “Forgot password?”</b> se OTP apne us email par mangwa lein.
                </p>
              </div>
              <button type="button" onClick={() => setSuperNoticeOpen(false)} aria-label="Close notice" className="shrink-0 rounded p-1 hover:bg-amber-100">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        )}
        {expiry && (
          <div role="alert" className={`mb-4 flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border px-4 py-3 text-sm ${expiry.daysLeft < 0 ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            <p className="flex-1">
              {expiry.daysLeft < 0
                ? `Your ${expiry.planName} plan expired on ${new Date(expiry.expiresAt).toLocaleDateString('en-IN')}. Renew now to keep receiving orders.`
                : `Your ${expiry.planName} plan ends in ${expiry.daysLeft} day${expiry.daysLeft === 1 ? '' : 's'} (${new Date(expiry.expiresAt).toLocaleDateString('en-IN')}). Renew before it expires to avoid interruptions.`}
            </p>
            <Button size="sm" variant={expiry.daysLeft < 0 ? 'destructive' : 'default'} onClick={() => setTab('settings')} className="shrink-0">Renew now</Button>
          </div>
        )}
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

      <footer className="border-t mt-8">
        <div className="container mx-auto px-4 py-3 text-center text-[11px] text-muted-foreground">
          Powered by CopySahaayak
        </div>
      </footer>

      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
      <ChangeEmailDialog open={emailOpen} onOpenChange={setEmailOpen} currentEmail={selfEmail} onDone={setSelfEmail} />
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
  payment?: { id?: string; status: string; utr?: string; rejectionReason?: string }
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

  // Accept the payment the shop actually received (cash / direct UPI / verified
  // UTR): payment → VERIFIED, order → CONFIRMED, print jobs queued instantly.
  async function acceptPayment(o: OrderRow) {
    if (!o.payment?.id) {
      toast({ title: 'Payment not ready', description: 'No payment row on this order yet.', variant: 'destructive' })
      return
    }
    const res = await fetch(`/api/admin/payments/${o.payment.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'VERIFY', note: 'Accepted from Orders tab' }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Accept failed', description: data.error, variant: 'destructive' })
      return
    }
    toast({ title: 'ऑर्डर accept हो गया — प्रिंट कतार में / Accepted — sent to print queue' })
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
                      {(o.status === 'PENDING_PAYMENT' || o.status === 'AWAITING_VERIFICATION') && o.payment?.id && (
                        <Button size="sm" onClick={() => acceptPayment(o)}>
                          <Check className="h-4 w-4 mr-1" aria-hidden />भुगतान accept करें — प्रिंट भेजें
                          <span className="sr-only">Accept payment and send to print</span>
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
  const [status, setStatus] = useState('ACTION')
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
      toast({ title: verify.action === 'VERIFY' ? 'Accept हो गया — प्रिंट जॉब कतार में / Accepted — job queued' : 'Payment rejected' })
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
            {['ACTION', 'PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'ALL'].map((s) => (
              <SelectItem key={s} value={s}>{s === 'ACTION' ? 'ACTION (जो अभी करने हैं)' : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" aria-hidden /></Button>
      </div>

      {payments.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Nothing to act on right now. New payments (UTR या नकद) automatically appear here.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <Card key={p.id}>
              <CardContent className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{p.order.orderNumber} · {formatInr(p.amountPaise)}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.order.customerName ? `${p.order.customerName} · ` : ''}{p.order.customerPhone || ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    UTR: <strong className="text-foreground">{p.utr || '— (नकद/सीधे दिया)'}</strong>
                    {p.payerName ? ` · ${p.payerName}` : ''}
                    {p.submittedAt ? ` · ${new Date(p.submittedAt).toLocaleString('en-IN')}` : ''}
                  </p>
                  {p.rejectionReason && <p className="text-xs text-red-600">{p.rejectionReason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={ORDER_STATUS_STYLES[p.status] || ''}>{p.status}</Badge>
                  {(p.status === 'PENDING' || p.status === 'SUBMITTED') && (
                    <>
                      <Button size="sm" onClick={() => { setVerify({ p, action: 'VERIFY' }); setNote('') }}>
                        <Check className="h-4 w-4 mr-1" aria-hidden />Accept & print
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => { setVerify({ p, action: 'REJECT' }); setNote('') }}>
                        <X className="h-4 w-4 mr-1" aria-hidden />Reject
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
            <DialogTitle>{verify?.action === 'VERIFY' ? 'भुगतान accept करें / Accept payment' : 'Reject payment'}</DialogTitle>
            <DialogDescription>
              {verify?.p.order.orderNumber} · {verify ? formatInr(verify.p.amountPaise) : ''} · UTR {verify?.p.utr || '—'}.
              {verify?.action === 'VERIFY'
                ? ' पुष्टि करें कि रकम आपके खाते/हाथ में आ गई है। Accept करते ही प्रिंट जॉब कतार में चला जाएगा। Confirm the money actually arrived before accepting — accepting queues the print jobs instantly.'
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
  healthStatus?: string
  healthDetail?: string | null
  lastSeenAt?: string
}

const HEALTH_BADGES: Record<string, { label: string; cls: string }> = {
  OK: { label: 'ठीक है ✓', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  LOW_TONER: { label: 'टोनर/इंक कम है', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  NO_TONER: { label: 'टोनर/इंक खत्म', cls: 'text-red-700 bg-red-50 border-red-200' },
  LOW_PAPER: { label: 'पेपर कम है', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  NO_PAPER: { label: 'पेपर खत्म', cls: 'text-red-700 bg-red-50 border-red-200' },
  PAPER_JAM: { label: 'पेपर जाम', cls: 'text-red-700 bg-red-50 border-red-200' },
  OFFLINE: { label: 'प्रिंटर ऑफलाइन', cls: 'text-gray-700 bg-gray-100 border-gray-200' },
  ERROR: { label: 'प्रिंटर समस्या', cls: 'text-red-700 bg-red-50 border-red-200' },
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

  async function removeDevice(id: string) {
    const res = await fetch(`/api/admin/devices/${id}?purge=1`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) {
      toast({ title: 'Failed', description: data.error, variant: 'destructive' })
      return
    }
    toast({ title: 'Device removed from the list' })
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

  async function removePrinter(id: string) {
    const res = await fetch(`/api/admin/printers?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) toast({ title: 'Failed', description: data.error, variant: 'destructive' })
    else {
      toast({ title: 'Printer removed from the list' })
      load()
    }
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
              (download it from the <a href="/#download" className="underline">home page</a>).
            </p>
          ) : (
            devices.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{d.name} <span className="text-muted-foreground">({d.machineName || 'unknown PC'})</span></p>
                  <p className="text-xs text-muted-foreground">
                    v{d.appVersion || '?'} · last seen {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('en-IN') : 'never'} · {d.printers.length} printer(s)
                  </p>
                  {d.status === 'ACTIVE' && d.printers.length === 0 && (
                    <p className="mt-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      ⚠ No printers configured — jobs cannot print. On the shop PC open Desktop Sahaayak (system tray) → Printer Settings… → tick a printer → Save.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={d.status === 'ACTIVE' ? 'default' : d.status === 'PENDING' ? 'secondary' : 'destructive'}>{d.status}</Badge>
                  {d.status !== 'REVOKED' && (
                    <Button size="sm" variant="destructive" onClick={() => revokeDevice(d.id)}>Revoke</Button>
                  )}
                  {(d.status === 'REVOKED' || d.status === 'PENDING') && (
                    <Button size="sm" variant="outline" onClick={() => removeDevice(d.id)}>Remove</Button>
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
            <p className="text-sm text-muted-foreground py-4 text-center">
              Printers appear here after a connector pairs <em>and</em> the shop owner ticks printers in
              Desktop Sahaayak → Printer Settings… on the shop PC (v1.3.1 or newer opens it automatically after pairing).
            </p>
          ) : (
            printers.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.displayName || p.windowsName}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.status} · last seen {p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString('en-IN') : 'never'}
                  </p>
                  {(() => {
                    const badge = HEALTH_BADGES[p.healthStatus || 'OK'] || HEALTH_BADGES.ERROR
                    const needsAttention = p.healthStatus && p.healthStatus !== 'OK'
                    return (
                      <span className={`mt-1 inline-block text-xs font-medium border rounded px-2 py-0.5 ${badge.cls}`}>
                        {needsAttention ? '⚠ ' : ''}{badge.label}{p.healthDetail ? ` — ${p.healthDetail}` : ''}
                      </span>
                    )
                  })()}
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
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => removePrinter(p.id)}>Remove</Button>
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
    groupBy: 'day' | 'week' | 'month'
    series: Array<{ period: string; revenuePaise: number; orders: number }>
    summary: { totalRevenuePaise: number; totalOrders: number; bwSides: number; colorSides: number; bwRevenuePaise: number; colorRevenuePaise: number; sheetsTotal: number }
    paper: Array<{ paperSize: string; colorMode: string; sides: number; sheets: number; revenuePaise: number }>
    machine: Array<{ device: string; completedJobs: number }>
  } | null>(null)
  const [days, setDays] = useState('30')
  const [groupBy, setGroupBy] = useState('day')
  const [loading, setLoading] = useState(true)
  const [backupRange, setBackupRange] = useState('month')

  useEffect(() => {
    let dead = false
    setLoading(true)
    fetch(`/api/admin/reports?days=${days}&groupBy=${groupBy}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!dead) setData(d) })
      .catch(() => {})
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [days, groupBy])

  if (!data) return <CenterSpinner />
  const max = Math.max(1, ...data.series.map((d) => d.revenuePaise))
  const periodLabel = groupBy === 'day' ? 'day' : groupBy === 'week' ? 'week' : 'month'
  const backupLabel = backupRange === 'week' ? 'यह हफ़्ता (7 दिन)' : backupRange === 'month' ? 'यह महीना (30 दिन)' : 'पूरा डेटा (All time)'
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Download className="h-4 w-4" aria-hidden /> डेटा बैकअप — Excel डाउनलोड</CardTitle>
          <CardDescription>
            अपना पूरा डेटा ख़ुद डाउनलोड करें — मोबाइल या PC, दोनों पर चलता है। फ़ाइल में Orders, Items, Payments और Summary
            (कुल कमाई, B/W व Colour कमाई, पेज, कॉपियाँ, पेंडिंग पेमेंट) सब कुछ होता है। बैकअप मैन्युअल है — सिर्फ़ आप डाउनलोड करते हैं, कोई अपने आप मेल नहीं जाता।
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Select value={backupRange} onValueChange={setBackupRange}>
            <SelectTrigger className="w-52" aria-label="बैकअप अवधि"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="week">यह हफ़्ता (पिछले 7 दिन)</SelectItem>
              <SelectItem value="month">यह महीना (पिछले 30 दिन)</SelectItem>
              <SelectItem value="all">पूरा डेटा (All time)</SelectItem>
            </SelectContent>
          </Select>
          <Button asChild>
            <a href={`/api/admin/backup?range=${backupRange}`} download aria-label={`${backupLabel} का बैकअप डाउनलोड करें`}>
              <Download className="h-4 w-4 mr-1.5" aria-hidden /> बैकअप डाउनलोड करें ({backupLabel})
            </a>
          </Button>
          <span className="text-xs text-muted-foreground">.xlsx फ़ाइल सीधे आपके डिवाइस में सेव होगी</span>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['7', '14', '30', '90', '180', '365'].map((d) => (
              <SelectItem key={d} value={d}>Last {d} days</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={setGroupBy}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Daily</SelectItem>
            <SelectItem value="week">Weekly</SelectItem>
            <SelectItem value="month">Monthly</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" className="ml-auto" asChild>
          <a href={`/api/admin/reports/export?days=${days}&groupBy=${groupBy}`} download>
            <Download className="h-4 w-4 mr-1.5" aria-hidden /> Download Excel
          </a>
        </Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label={`Revenue (per ${periodLabel})`} value={formatInr(data.summary.totalRevenuePaise)} />
        <StatCard label="Paid orders" value={String(data.summary.totalOrders)} />
        <StatCard label="B/W sides" value={String(data.summary.bwSides)} />
        <StatCard label="Colour sides" value={String(data.summary.colorSides)} />
        <StatCard label="Paper sheets used" value={String(data.summary.sheetsTotal)} />
      </div>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Collection by {periodLabel}</CardTitle></CardHeader>
        <CardContent>
          {data.series.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No confirmed orders in this period yet.</p>
          ) : (
            <div className={`space-y-1.5 ${loading ? 'opacity-60' : ''}`}>
              {data.series.map((d) => (
                <div key={d.period} className="flex items-center gap-2 text-xs">
                  <span className="w-20 shrink-0 text-muted-foreground">{d.period.slice(5)}</span>
                  <div className="h-4 rounded bg-primary/70" style={{ width: `${(d.revenuePaise / max) * 70}%` }} />
                  <span className="font-medium">{formatInr(d.revenuePaise)}</span>
                  <span className="text-muted-foreground">({d.orders})</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Paper usage (by size & colour)</CardTitle></CardHeader>
          <CardContent>
            {data.paper.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No paper used yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Size</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Sides</TableHead>
                    <TableHead className="text-right">Sheets</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.paper.map((p) => (
                    <TableRow key={`${p.paperSize}-${p.colorMode}`}>
                      <TableCell>{p.paperSize}</TableCell>
                      <TableCell>{p.colorMode === 'BW' ? 'B/W' : 'Colour'}</TableCell>
                      <TableCell className="text-right">{p.sides}</TableCell>
                      <TableCell className="text-right">{p.sheets}</TableCell>
                      <TableCell className="text-right">{formatInr(p.revenuePaise)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Prints by machine</CardTitle></CardHeader>
          <CardContent>
            {data.machine.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No completed prints in this period yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead className="text-right">Completed jobs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.machine.map((m) => (
                    <TableRow key={m.device}>
                      <TableCell className="truncate max-w-[200px]">{m.device}</TableCell>
                      <TableCell className="text-right">{m.completedJobs}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
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
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null)
  // Scan-to-pay QR for plan payments — always points to the PLATFORM (super admin) UPI.
  const [payQr, setPayQr] = useState<{ dataUrl: string; payload: string; vpa: string; payee: string; amountPaise: number } | null>(null)
  const [payQrErr, setPayQrErr] = useState('')
  const [downgradeOpen, setDowngradeOpen] = useState(false)
  const [downgrading, setDowngrading] = useState(false)

  useEffect(() => {
    if (!payPlan) { setPayQr(null); setPayQrErr(''); return }
    let live = true
    setPayQr(null)
    setPayQrErr('')
    fetch(`/api/admin/subscription/qr?planCode=${payPlan.code}`, { cache: 'no-store' })
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Could not load payment QR')
        if (live) setPayQr(d)
      })
      .catch((e) => { if (live) setPayQrErr(e instanceof Error ? e.message : 'Could not load payment QR') })
    return () => { live = false }
  }, [payPlan])

  function copyPlatformUpi() {
    if (!payQr?.vpa) return
    navigator.clipboard?.writeText(payQr.vpa).then(
      () => toast({ title: 'UPI ID copied', description: payQr.vpa }),
      () => toast({ title: 'Copy failed', variant: 'destructive' })
    )
  }

  useEffect(() => {
    fetch(`/api/shops/${shop.slug}/qr`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.dataUrl) setQr({ url: d.url, dataUrl: d.dataUrl }) })
      .catch(() => {})
  }, [shop.slug])

  function copyShopLink() {
    const link = qr?.url || `${window.location.origin}/s/${shop.slug}`
    navigator.clipboard?.writeText(link).then(
      () => toast({ title: 'Ordering link copied', description: link }),
      () => toast({ title: 'Copy failed', variant: 'destructive' })
    )
  }

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

  async function downgradeToFree() {
    setDowngrading(true)
    try {
      const res = await fetch('/api/admin/subscription/downgrade', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Downgrade failed')
      toast({ title: 'Moved to the Trial plan', description: '7-day Trial limits now apply. You can upgrade again anytime.' })
      setDowngradeOpen(false)
      fetch('/api/admin/subscription', { cache: 'no-store' }).then((r) => r.json()).then(setSub)
    } catch (err) {
      toast({ title: 'Downgrade failed', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setDowngrading(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><QrCode className="h-4 w-4" aria-hidden /> Your shop QR code</CardTitle>
          <CardDescription>
            Print this and keep it at your counter. Customers scan it with any phone camera to order — no app needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-4 sm:items-center">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr.dataUrl} alt={`QR code for ordering from ${shop.name}`} className="h-40 w-40 shrink-0 rounded-lg border bg-white p-1" />
          ) : (
            <div className="h-40 w-40 shrink-0 rounded-lg border bg-muted animate-pulse" aria-hidden />
          )}
          <div className="min-w-0 space-y-2">
            <p className="text-sm break-all">
              <span className="text-muted-foreground">Ordering link: </span>
              <strong className="break-all">{qr?.url || `/s/${shop.slug}`}</strong>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <a href={`/qr/${shop.slug}`} target="_blank" rel="noopener noreferrer">
                  <Printer className="h-4 w-4 mr-1.5" aria-hidden /> Print counter sign (A4)
                </a>
              </Button>
              {qr && (
                <Button size="sm" variant="outline" asChild>
                  <a href={qr.dataUrl} download={`copysahaayak-qr-${shop.slug}.png`}>
                    <FileText className="h-4 w-4 mr-1.5" aria-hidden /> Download PNG
                  </a>
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={copyShopLink}>
                <Check className="h-4 w-4 mr-1.5" aria-hidden /> Copy link
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Tip: laminate the printed sign — it works on every Android and iPhone camera.
            </p>
          </div>
        </CardContent>
      </Card>

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
            Your customer ordering link: <strong>/s/{shop.slug}</strong> — the printable QR code is at the top of this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sub?.subscription && (
            <p className="text-sm">
              Current: <strong>{sub.subscription.plan?.name}</strong> · {sub.subscription.status}
              {sub.subscription.expiresAt ? ` · until ${new Date(sub.subscription.expiresAt).toLocaleDateString('en-IN')}` : ''}
            </p>
          )}
          {sub?.superAdminUpi ? (
            <p className="text-sm text-muted-foreground">All plan payments go to the platform UPI: <strong className="text-foreground">{sub.superAdminUpi}</strong> ({sub.superAdminPayee})</p>
          ) : (
            <p className="text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">
              Platform UPI is not configured yet — you cannot pay for a plan right now. Please contact the platform admin.
            </p>
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
          {sub?.subscription?.plan && sub.subscription.plan.pricePaise > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border px-3 py-2">
              <p className="text-sm text-muted-foreground flex-1">
                Paid plan abhi nahi chahiye? Move this shop back to the <strong className="text-foreground">7-day Trial plan</strong> — Trial limits apply immediately, payment history is kept and you can upgrade again anytime. (Trial ke baad plan lena zaroori hai.)
              </p>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => setDowngradeOpen(true)}>Downgrade to Trial</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!payPlan} onOpenChange={(v) => !v && setPayPlan(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{payPlan?.name} plan — ₹{payPlan ? (payPlan.pricePaise / 100).toFixed(0) : ''} का भुगतान</DialogTitle>
            <DialogDescription>
              तीन आसान कदम: 1) QR स्कैन करें 2) रकम भेजें 3) नीचे UTR डालें। पैसा सीधे platform admin के UPI में जाएगा — जाँच के बाद plan चालू होगा।
              <br /><span className="text-xs">Scan the QR with any UPI app (GPay / PhonePe / Paytm), then enter the UTR below. The platform admin verifies it before your plan activates.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {payQrErr && (
              <p className="text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2">{payQrErr}</p>
            )}
            {payQr && (
              <div className="flex flex-col items-center gap-2 rounded-lg border bg-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={payQr.dataUrl} alt={`Scan to pay ₹${(payQr.amountPaise / 100).toFixed(0)} to ${payQr.vpa}`} className="h-52 w-52" />
                <p className="text-xs text-muted-foreground text-center">
                  भुगतान होगा: <strong className="text-foreground">{payQr.payee}</strong> · <span className="font-mono">{payQr.vpa}</span>
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button size="sm" asChild>
                    <a href={payQr.payload}>
                      <QrCode className="h-4 w-4 mr-1.5" aria-hidden /> Open in UPI app
                    </a>
                  </Button>
                  <Button size="sm" variant="outline" onClick={copyPlatformUpi}>
                    <Check className="h-4 w-4 mr-1.5" aria-hidden /> Copy UPI ID
                  </Button>
                </div>
              </div>
            )}
            {!payQr && !payQrErr && (
              <div className="h-52 w-52 mx-auto rounded-lg border bg-muted animate-pulse" aria-hidden />
            )}
            <div className="space-y-1"><Label>UTR नंबर (UPI app के History में मिलेगा)</Label><Input value={utr} onChange={(e) => setUtr(e.target.value.toUpperCase())} placeholder="जैसे: 402512345678" inputMode="numeric" /></div>
            <div className="space-y-1"><Label>Payer name (optional)</Label><Input value={payerName} onChange={(e) => setPayerName(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayPlan(null)}>Cancel</Button>
            <Button onClick={submitSubPayment}>भुगतान हो गया — Submit for verification</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={downgradeOpen} onOpenChange={setDowngradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move to the 7-day Trial plan?</DialogTitle>
            <DialogDescription>
              Your {sub?.subscription?.plan?.name} plan ends immediately and 7-day Trial limits apply (orders per month, devices). Your payment history is kept and you can upgrade again anytime. Trial khatam hone par paid plan lena hoga.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDowngradeOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={downgrading} onClick={downgradeToFree}>
              {downgrading && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Move to Trial plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
