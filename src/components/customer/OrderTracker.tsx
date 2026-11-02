'use client'

// Live order tracking for the customer: polls status every 8 seconds.
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { CheckCircle2, Clock, CircleDashed, Printer, XCircle, IndianRupee } from 'lucide-react'

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
  payment: { status: string; utr?: string; rejectionReason?: string; amountPaise: number } | null
}

const STATUS_FLOW = ['PENDING_PAYMENT', 'AWAITING_VERIFICATION', 'CONFIRMED', 'COMPLETED']

export function OrderTracker({ slug, shopName, orderNumber }: { slug: string; shopName: string; orderNumber: string }) {
  const [order, setOrder] = useState<TrackedOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notAuthorized, setNotAuthorized] = useState(false)
  const [phone, setPhone] = useState('')

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
            <p className="font-medium">This order is linked to another device.</p>
            <p className="text-sm text-muted-foreground">Enter the phone number used while ordering to verify:</p>
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
          <p className="text-sm text-muted-foreground">{shopName}</p>
          <h1 className="text-xl font-bold">Order {order.orderNumber}</h1>
        </div>

        <Card>
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status</span>
              {rejected ? (
                <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" aria-hidden /> {order.status}</Badge>
              ) : order.status === 'COMPLETED' ? (
                <Badge className="gap-1 bg-green-600"><CheckCircle2 className="h-3 w-3" aria-hidden /> Printed & ready</Badge>
              ) : (
                <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3 animate-pulse" aria-hidden /> In progress</Badge>
              )}
            </div>

            {!rejected && (
              <div className="flex items-center gap-1">
                {STATUS_FLOW.map((s, i) => (
                  <div key={s} className="flex-1 flex flex-col items-center gap-1">
                    <div className={`h-1.5 w-full rounded-full ${i <= stepIdx ? 'bg-primary' : 'bg-muted'}`} />
                    <span className={`text-[10px] ${i <= stepIdx ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {['Placed', 'Verifying', 'Printing', 'Ready'][i]}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {order.payment?.status === 'REJECTED' && order.payment.rejectionReason && (
              <p className="text-sm text-red-600">Payment rejected: {order.payment.rejectionReason}. Please contact the shop.</p>
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
                      ? 'Sent to printer — completed'
                      : item.printJobs.some((j) => j.status === 'SPOOLING')
                        ? 'Printing now…'
                        : item.printJobs.some((j) => j.status === 'FAILED')
                          ? 'Printer reported an issue — shop is retrying'
                          : 'Queued for printing'}
                  </p>
                )}
              </div>
            ))}
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Total</span>
              <span className="flex items-center"><IndianRupee className="h-4 w-4" aria-hidden />{(order.totalPaise / 100).toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">This page refreshes automatically every 8 seconds.</p>
      </div>
    </main>
  )
}
