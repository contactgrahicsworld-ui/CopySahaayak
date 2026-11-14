'use client'

// Live order tracking for the customer: polls status every 8 seconds.
// If the shop runs the YouPI gateway, a "Pay Online" action opens the hosted
// checkout (server-side session create — no keys in the browser). The customer
// returns via the gateway's returnUrl and this page's 8s polling shows the
// auto-advanced status (gateway webhook verified the payment).
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { CheckCircle2, Clock, CircleDashed, Printer, XCircle, IndianRupee, Wallet, Loader2 } from 'lucide-react'

interface TrackedOrder {
  orderNumber: string
  status: string
  totalPaise: number
  items: Array<{
    id: string
    fileName: string
    pageCount: number
    colorMode: string
    paperSize: string
    duplex: boolean
    copies: number
    totalPaise: number
    printJobs: Array<{ id: string; status: string }>
  }>
  payment: { status: string; utr?: string; rejectionReason?: string; amountPaise: number; refundVpa?: string | null; refundUtr?: string | null } | null
}

const STATUS_FLOW = ['PENDING_PAYMENT', 'AWAITING_VERIFICATION', 'CONFIRMED', 'COMPLETED']

export function OrderTracker({ slug, shopName, orderNumber, gatewayEnabled = false }: { slug: string; shopName: string; orderNumber: string; gatewayEnabled?: boolean }) {
  const [order, setOrder] = useState<TrackedOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notAuthorized, setNotAuthorized] = useState(false)
  const [phone, setPhone] = useState('')
  const [paying, setPaying] = useState(false)
  // Refund flow (money-safety): when the gateway flags REFUND_DUE the
  // customer submits their own UPI ID so the shop can send the money back.
  const [refundVpa, setRefundVpa] = useState('')
  const [refundSent, setRefundSent] = useState(false)
  const [refundBusy, setRefundBusy] = useState(false)

  async function submitRefundVpa() {
    setRefundBusy(true)
    try {
      const res = await fetch(`/api/shops/${slug}/orders/${orderNumber}/refund-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vpa: refundVpa.trim(), phone: phone || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not submit')
      setRefundSent(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'UPI ID submit nahi ho payi — dobara koshish karein')
    } finally {
      setRefundBusy(false)
    }
  }

  async function payOnline() {
    setPaying(true)
    try {
      const res = await fetch(`/api/shops/${slug}/orders/${orderNumber}/gateway-session`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Payment session could not start')
      window.location.href = data.checkoutUrl as string
      return // navigating away; spinner stays
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Gateway se connect nahi ho paya — UPI QR use karein')
      setPaying(false)
    }
  }

  useEffect(() => {
    let stop = false
    async function poll() {
      try {
        const res = await fetch(`/api/shops/${slug}/orders/${orderNumber}${phone ? `?phone=${encodeURIComponent(phone)}` : ''}`, { cache: 'no-store' })
        if (res.status === 403) {
          setNotAuthorized(true)
          return
        }
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (!stop) {
          setOrder(data)
          setNotAuthorized(false)
          setError(null)
        }
      } catch {
        if (!stop) setError('Could not load the order')
      }
    }
    poll()
    const t = setInterval(poll, 8000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [slug, orderNumber, phone])

  if (notAuthorized) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 space-y-3 text-center">
            <p className="font-medium">यह ऑर्डर किसी दूसरे फ़ोन से बनाया गया था।</p>
            <p className="text-sm text-muted-foreground">ऑर्डर करते समय जो फ़ोन नंबर डाला था, वह नीचे लिखें:</p>
            <p className="text-xs text-muted-foreground -mt-2">This order is linked to another device — enter the phone number used while ordering:</p>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98xxxxxxxx"
              inputMode="tel"
              className="w-full rounded-md border px-3 py-2 text-sm"
              aria-label="Phone number used while ordering"
            />
          </CardContent>
        </Card>
      </main>
    )
  }

  if (error && !order) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">{error}</p>
      </main>
    )
  }

  if (!order) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Clock className="h-6 w-6 animate-pulse text-muted-foreground" aria-hidden />
      </main>
    )
  }

  const rejected = order.status === 'REJECTED' || order.status === 'CANCELLED'
  const stepIdx = STATUS_FLOW.indexOf(order.status)

  return (
    <main className="min-h-screen bg-muted/30">
      <div className="container max-w-lg mx-auto px-4 py-6 space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">{shopName} · दुकान</p>
          <h1 className="text-xl font-bold">ऑर्डर / Order {order.orderNumber}</h1>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-4">
            {order.status === 'PENDING_PAYMENT' && gatewayEnabled && (
              <div className="space-y-2">
                <Button type="button" className="w-full" onClick={payOnline} disabled={paying}>
                  {paying ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <Wallet className="h-4 w-4 mr-1.5" aria-hidden />}
                  Online Pay karein — UPI Gateway (GPay/PhonePe/Paytm)
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">Gateway verify karte hi order apne-aap confirm ho jayega. UPI QR se bhi pay kar sakte hain.</p>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">स्थिति / Status</span>
              {rejected ? (
                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" aria-hidden /> रद्द / {order.status}</Badge>
              ) : order.status === 'COMPLETED' ? (
                <Badge className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" aria-hidden /> छप गया — ले जाएँ / Ready</Badge>
              ) : (
                <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3 animate-pulse" aria-hidden /> काम चल रहा है / In progress</Badge>
              )}
            </div>

            {!rejected && (
              <div className="flex items-center gap-1">
                {STATUS_FLOW.map((s, i) => (
                  <div key={s} className="flex-1 flex flex-col items-center gap-1">
                    <div className={`h-1.5 w-full rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-muted'}`} />
                    <span className={`text-[10px] ${i <= stepIdx ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {['लगाया / Placed', 'जाँच / Verifying', 'छपाई / Printing', 'तैयार / Ready'][i]}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {order.payment?.status === 'REJECTED' && order.payment.rejectionReason && (
              <p className="text-sm text-red-600">भुगतान नामंज़ूर: {order.payment.rejectionReason} — कृपया दुकान से संपर्क करें।</p>
            )}
            {order.payment?.status === 'REFUND_DUE' && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 space-y-2">
                <p className="text-sm font-medium text-amber-900">आपके ₹{(order.payment.amountPaise / 100).toFixed(2)} वापस किए जाएँगे / Your payment will be refunded</p>
                {order.payment.refundVpa ? (
                  <p className="text-xs text-amber-900">आपकी UPI ID ({order.payment.refundVpa}) दुकान को मिल गई है — refund जल्द आपके UPI पर आएगा।</p>
                ) : refundSent ? (
                  <p className="text-xs text-amber-900">धन्यवाद! दुकान को आपकी UPI ID मिल गई है — refund जल्द आएगा।</p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-xs text-amber-900">अपनी UPI ID लिखें ताकि दुकान पैसा सीधे आपके UPI पर भेज सके:</p>
                    <input
                      value={refundVpa}
                      onChange={(e) => setRefundVpa(e.target.value)}
                      placeholder="yourname@upi"
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                      aria-label="Your UPI ID for refund"
                    />
                    <button
                      type="button"
                      onClick={submitRefundVpa}
                      disabled={refundBusy || !/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/.test(refundVpa.trim())}
                      className="w-full rounded-md bg-amber-600 px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {refundBusy ? 'भेज रहे हैं…' : 'UPI ID भेजें / Send'}
                    </button>
                  </div>
                )}
              </div>
            )}
            {order.payment?.status === 'REFUNDED' && (
              <p className="text-sm rounded-md border border-green-300 bg-green-50 text-green-800 px-3 py-2">
                ₹{(order.payment.amountPaise / 100).toFixed(2)} वापस कर दिए गए हैं / Refunded to your UPI{order.payment.refundUtr ? ` (ref ${order.payment.refundUtr})` : ''}
              </p>
            )}
            <Separator />
            {order.items.map((item) => (
              <div key={item.id} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="truncate mr-2">{item.fileName}</span>
                  <span className="font-medium whitespace-nowrap">₹{(item.totalPaise / 100).toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {item.colorMode === 'BW' ? 'B/W' : 'Colour'} · {item.paperSize} · {item.pageCount} sides × {item.copies} {item.duplex ? '· duplex' : ''}
                </p>
                {item.printJobs.length > 0 && (
                  <p className="text-xs flex items-center gap-1 text-muted-foreground">
                    <Printer className="h-3 w-3" aria-hidden />
                    {item.printJobs.every((j) => j.status === 'COMPLETED')
                      ? 'प्रिंटर को भेजा गया — पूरा हुआ / Completed'
                      : item.printJobs.some((j) => j.status === 'SPOOLING')
                        ? 'अभी छप रहा है / Printing now…'
                        : item.printJobs.some((j) => j.status === 'FAILED')
                          ? 'प्रिंटर में दिक्कत — दुकान फिर कोशिश कर रही है'
                          : 'प्रिंट के लिए क़तार में / Queued'}
                  </p>
                )}
              </div>
            ))}
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>कुल / Total</span>
              <span className="flex items-center"><IndianRupee className="h-4 w-4" aria-hidden />{(order.totalPaise / 100).toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const status = order.status === 'COMPLETED' ? 'print ho kar taiyar hai' : order.status === 'CONFIRMED' ? 'confirm ho gaya hai' : order.status === 'REJECTED' || order.status === 'CANCELLED' ? 'rad kar diya gaya hai' : 'verify ho raha hai'
              const text = `Mera ${shopName} order ${order.orderNumber} (${(order.totalPaise / 100).toFixed(2)}) ${status}.`
              window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
            }}
          >
            WhatsApp par status share karein
          </Button>
        </div>

        <p className="text-xs text-muted-foreground text-center">यह पन्ना हर 8 सेकंड में अपने-आप अपडेट होता है / Auto-refreshes every 8 s</p>
      </div>
    </main>
  )
}
