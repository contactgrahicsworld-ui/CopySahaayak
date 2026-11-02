'use client'

// Mobile-first customer ordering wizard:
// Upload → Configure items → Details → Pay (dynamic UPI QR + UTR) → Track.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import {
  FileUp, FileText, ImageIcon, Loader2, IndianRupee, Trash2, CheckCircle2,
  Clock, Printer, Copy, ArrowLeft,
} from 'lucide-react'
import type { ColorMode, PaperSize } from '@/lib/constants'

interface PricingRule { paperSize: PaperSize; colorMode: ColorMode; singleSidedPaise: number; duplexPaise: number }
interface ShopInfo { name: string; slug: string; phone?: string | null; address?: string | null; upiConfigured: boolean }

interface DocItem {
  key: string
  documentId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  pageCount: number
  previewUrl: string
  colorMode: ColorMode
  paperSize: PaperSize
  duplex: boolean
  copies: number
  rangeAll: boolean
  pageFrom: number
  pageTo: number
}

interface PlacedOrder {
  orderNumber: string
  totalPaise: number
  upi: { payload: string; vpa: string; payeeName: string } | null
  qrDataUrl?: string
}

const SIZES: PaperSize[] = ['A4', 'A3', 'A5', 'LEGAL']

export function CustomerWizard({ shop, pricing }: { shop: ShopInfo; pricing: PricingRule[] }) {
  const { toast } = useToast()
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const [stage, setStage] = useState<'CONFIG' | 'PAY' | 'DONE'>('CONFIG')
  const [items, setItems] = useState<DocItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [placing, setPlacing] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [order, setOrder] = useState<PlacedOrder | null>(null)
  const [utr, setUtr] = useState('')
  const [submittingUtr, setSubmittingUtr] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const priceOf = useCallback(
    (item: DocItem) => {
      const rule = pricing.find((p) => p.paperSize === item.paperSize && p.colorMode === item.colorMode)
      if (!rule) return null
      const sides = item.rangeAll ? item.pageCount : Math.max(1, Math.min(item.pageTo, item.pageCount) - Math.max(1, item.pageFrom) + 1)
      const unit = item.duplex ? rule.duplexPaise : rule.singleSidedPaise
      return { sides, unit, total: unit * sides * item.copies }
    },
    [pricing]
  )

  const total = useMemo(() => items.reduce((s, it) => s + (priceOf(it)?.total || 0), 0), [items, priceOf])
  const missingRules = items.length > 0 && items.some((it) => !priceOf(it))

  useEffect(() => {
    // Guest session (no registration)
    fetch(`/api/shops/${slug}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
  }, [slug])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`/api/shops/${slug}/uploads`, { method: 'POST', body: form })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || `Upload failed for ${file.name}`)
        setItems((prev) => [
          ...prev,
          {
            key: data.documentId,
            documentId: data.documentId,
            fileName: data.fileName,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            pageCount: data.pageCount,
            previewUrl: data.previewUrl,
            colorMode: 'BW',
            paperSize: 'A4',
            duplex: false,
            copies: 1,
            rangeAll: true,
            pageFrom: 1,
            pageTo: data.pageCount,
          },
        ])
      }
      toast({ title: 'Files uploaded', description: 'Pages counted by the server — choose options below.' })
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function patchItem(key: string, patch: Partial<DocItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  async function placeOrder() {
    if (items.length === 0) return
    if (missingRules) {
      toast({ title: 'Some options are unavailable', description: 'This shop does not offer a selected size/colour combination.', variant: 'destructive' })
      return
    }
    if (phone && !/^[0-9+\-\s]{6,15}$/.test(phone)) {
      toast({ title: 'Phone number looks wrong', description: 'Enter 6-15 digits or leave it empty.', variant: 'destructive' })
      return
    }
    setPlacing(true)
    try {
      const res = await fetch(`/api/shops/${slug}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name || undefined,
          customerPhone: phone || undefined,
          items: items.map((it) => ({
            documentId: it.documentId,
            colorMode: it.colorMode,
            paperSize: it.paperSize,
            duplex: it.duplex,
            copies: it.copies,
            pageFrom: it.rangeAll ? null : it.pageFrom,
            pageTo: it.rangeAll ? null : it.pageTo,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not place order')
      setOrder({ ...data })
      setStage('PAY')
      window.scrollTo({ top: 0 })
    } catch (err) {
      toast({ title: 'Order failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' })
    } finally {
      setPlacing(false)
    }
  }

  async function submitUtr() {
    if (!order) return
    if (!/^[a-zA-Z0-9]{8,22}$/.test(utr.trim())) {
      toast({ title: 'Enter a valid UTR / reference number', description: 'It is in your UPI app payment history (8-22 letters/digits).', variant: 'destructive' })
      return
    }
    setSubmittingUtr(true)
    try {
      const res = await fetch(`/api/shops/${slug}/orders/${order.orderNumber}/utr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utr: utr.trim(), payerName: name || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not submit reference')
      setStage('DONE')
    } catch (err) {
      toast({ title: 'Submission failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' })
    } finally {
      setSubmittingUtr(false)
    }
  }

  if (stage === 'PAY' && order) {
    return (
      <PayStage
        shop={shop}
        order={order}
        utr={utr}
        setUtr={setUtr}
        submitting={submittingUtr}
        onSubmit={submitUtr}
        onBack={() => setStage('CONFIG')}
      />
    )
  }

  if (stage === 'DONE' && order) {
    return <DoneStage slug={slug} orderNumber={order.orderNumber} />
  }

  return (
    <main className="min-h-screen bg-muted/30 pb-28">
      <header className="bg-background border-b">
        <div className="container max-w-lg mx-auto px-4 py-4">
          <h1 className="font-bold text-lg leading-tight">{shop.name}</h1>
          {shop.address && <p className="text-xs text-muted-foreground">{shop.address}</p>}
          {shop.phone && <p className="text-xs text-muted-foreground">{shop.phone}</p>}
        </div>
      </header>

      <div className="container max-w-lg mx-auto px-4 pt-4 space-y-4">
        <Card>
          <CardContent className="pt-4">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/jpeg,image/png"
              multiple
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
              aria-label="Upload PDF or images"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-2 hover:bg-accent transition-colors disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
              ) : (
                <FileUp className="h-8 w-8 text-muted-foreground" aria-hidden />
              )}
              <span className="font-medium">{uploading ? 'Uploading & counting pages…' : 'Tap to upload PDF or images'}</span>
              <span className="text-xs text-muted-foreground">PDF, JPG, PNG · up to 25 MB · pages counted automatically</span>
            </button>
          </CardContent>
        </Card>

        {items.map((item) => {
          const price = priceOf(item)
          const ruleExists = (cm: ColorMode, ps: PaperSize) => pricing.some((p) => p.colorMode === cm && p.paperSize === ps)
          return (
            <Card key={item.key}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start gap-3">
                  {item.mimeType === 'application/pdf' ? (
                    <FileText className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ImageIcon className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.pageCount} page{item.pageCount > 1 ? 's' : ''} · {(item.sizeBytes / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <a href={item.previewUrl} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground">
                    Preview
                  </a>
                  <Button variant="ghost" size="icon" aria-label="Remove file" onClick={() => setItems((p) => p.filter((x) => x.key !== item.key))}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>

                <Separator />

                <div>
                  <Label className="text-xs text-muted-foreground">Colour</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {(['BW', 'COLOR'] as ColorMode[]).map((cm) => (
                      <button
                        key={cm}
                        type="button"
                        disabled={!ruleExists(cm, item.paperSize)}
                        onClick={() => patchItem(item.key, { colorMode: cm })}
                        className={`rounded-lg border px-3 py-2.5 text-sm font-medium disabled:opacity-40 ${
                          item.colorMode === cm ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                        }`}
                      >
                        {cm === 'BW' ? 'Black & White' : 'Colour'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">Paper size</Label>
                  <div className="grid grid-cols-4 gap-2 mt-1">
                    {SIZES.map((ps) => (
                      <button
                        key={ps}
                        type="button"
                        disabled={!ruleExists(item.colorMode, ps)}
                        onClick={() => patchItem(item.key, { paperSize: ps })}
                        className={`rounded-lg border px-1 py-2.5 text-sm font-medium disabled:opacity-40 ${
                          item.paperSize === ps ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                        }`}
                      >
                        {ps}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Copies</Label>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Decrease copies" onClick={() => patchItem(item.key, { copies: Math.max(1, item.copies - 1) })}>−</Button>
                    <span className="w-10 text-center font-semibold">{item.copies}</span>
                    <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Increase copies" onClick={() => patchItem(item.key, { copies: Math.min(500, item.copies + 1) })}>+</Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs text-muted-foreground">Print both sides (duplex)</Label>
                    <p className="text-[11px] text-muted-foreground">Cheaper per page where the shop offers it</p>
                  </div>
                  <Switch checked={item.duplex} onCheckedChange={(v) => patchItem(item.key, { duplex: v })} aria-label="Double-sided printing" />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">Pages</Label>
                    <div className="flex items-center gap-2 text-sm">
                      <span>All {item.pageCount}</span>
                      <Switch checked={!item.rangeAll} onCheckedChange={(v) => patchItem(item.key, { rangeAll: !v })} aria-label="Custom page range" />
                      <span>Range</span>
                    </div>
                  </div>
                  {!item.rangeAll && (
                    <div className="flex items-center gap-2 mt-2">
                      <Input
                        type="number"
                        min={1}
                        max={item.pageCount}
                        value={item.pageFrom}
                        onChange={(e) => patchItem(item.key, { pageFrom: Math.max(1, Number(e.target.value) || 1) })}
                        aria-label="First page"
                      />
                      <span className="text-muted-foreground">to</span>
                      <Input
                        type="number"
                        min={1}
                        max={item.pageCount}
                        value={item.pageTo}
                        onChange={(e) => patchItem(item.key, { pageTo: Math.min(item.pageCount, Number(e.target.value) || item.pageCount) })}
                        aria-label="Last page"
                      />
                    </div>
                  )}
                </div>

                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {price ? `${price.sides} sides × ${item.copies} cop${item.copies > 1 ? 'ies' : 'y'}` : '—'}
                  </span>
                  <span className="font-semibold">{price ? `₹${(price.total / 100).toFixed(2)}` : 'Not offered'}</span>
                </div>
              </CardContent>
            </Card>
          )
        })}

        {items.length > 0 && (
          <Card>
            <CardContent className="pt-4 space-y-3">
              <p className="text-sm font-medium">Your details (optional — helps the shop reach you)</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="cname" className="text-xs">Name</Label>
                  <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cphone" className="text-xs">Phone</Label>
                  <Input id="cphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" inputMode="tel" autoComplete="tel" />
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {items.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="container max-w-lg mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Total ({items.length} file{items.length > 1 ? 's' : ''})</p>
              <p className="text-xl font-bold flex items-center">
                <IndianRupee className="h-5 w-5" aria-hidden />
                {(total / 100).toFixed(2)}
              </p>
            </div>
            <Button size="lg" onClick={placeOrder} disabled={placing || missingRules}>
              {placing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <Printer className="h-4 w-4 mr-2" aria-hidden />}
              Place order & pay
            </Button>
          </div>
        </div>
      )}
    </main>
  )
}

function PayStage({
  shop, order, utr, setUtr, submitting, onSubmit, onBack,
}: {
  shop: ShopInfo
  order: PlacedOrder
  utr: string
  setUtr: (v: string) => void
  submitting: boolean
  onSubmit: () => void
  onBack: () => void
}) {
  const { toast } = useToast()
  if (!shop.upiConfigured || !order.upi) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center space-y-2">
            <p className="font-medium">This shop has not configured UPI payments yet.</p>
            <Button variant="outline" onClick={onBack}>Go back</Button>
          </CardContent>
        </Card>
      </main>
    )
  }
  return (
    <main className="min-h-screen bg-muted/30">
      <div className="container max-w-lg mx-auto px-4 py-6 space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" aria-hidden /> Edit order
        </Button>
        <Card>
          <CardContent className="pt-6 pb-6 text-center space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Order {order.orderNumber}</p>
              <p className="text-3xl font-bold flex items-center justify-center">
                <IndianRupee className="h-7 w-7" aria-hidden />{(order.totalPaise / 100).toFixed(2)}
              </p>
            </div>
            {order.qrDataUrl && (
              <div className="mx-auto bg-white p-2 rounded-xl w-fit border">
                <img src={order.qrDataUrl} alt={`UPI QR code to pay ₹${(order.totalPaise / 100).toFixed(2)} to ${order.upi.payeeName}`} className="h-56 w-56" />
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              Scan with any UPI app (GPay, PhonePe, Paytm, BHIM) — the amount is pre-filled.
              Paying from the same phone? Tap the button below to open your UPI app directly.
            </p>
            <a href={order.upi.payload} className="block">
              <Button variant="outline" className="w-full">Open UPI app to pay</Button>
            </a>
            <Separator />
            <div className="text-left space-y-1.5">
              <Label htmlFor="utr" className="text-sm font-medium">Enter UPI reference / UTR number</Label>
              <Input
                id="utr"
                value={utr}
                onChange={(e) => setUtr(e.target.value.toUpperCase())}
                placeholder="e.g. 402512345678"
                inputMode="numeric"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Find it in your UPI app → payment history → transaction details. The shop verifies it before printing.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="px-2"
                onClick={() => {
                  navigator.clipboard?.writeText(order.orderNumber).then(
                    () => toast({ title: 'Order number copied' }),
                    () => {}
                  )
                }}
              >
                <Copy className="h-3 w-3 mr-1" aria-hidden /> Copy order number
              </Button>
            </div>
            <Button className="w-full" size="lg" onClick={onSubmit} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden />}
              I have paid — submit reference
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function DoneStage({ slug, orderNumber }: { slug: string; orderNumber: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-sm w-full text-center">
        <CardContent className="pt-8 pb-8 space-y-4">
          <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" aria-hidden />
          <div>
            <p className="font-bold text-lg">Reference submitted</p>
            <p className="text-sm text-muted-foreground">
              Order <strong>{orderNumber}</strong> is awaiting payment verification by the shop. Track live status here.
            </p>
          </div>
          <Button asChild className="w-full">
            <a href={`/s/${slug}/order/${orderNumber}`}>Track order</a>
          </Button>
          <Badge variant="outline" className="mx-auto">
            <Clock className="h-3 w-3 mr-1" aria-hidden /> Save this link to check anytime
          </Badge>
        </CardContent>
      </Card>
    </main>
  )
}
