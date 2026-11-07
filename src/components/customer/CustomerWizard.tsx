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
  const [utrSkipped, setUtrSkipped] = useState(false)
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
    // Naam + mobile are mandatory: the shop must know WHO every order belongs to.
    if (!name.trim() || name.trim().length < 2) {
      toast({ title: 'अपना नाम लिखें — अनिवार्य / Name is required', description: 'दुकान को पता रहे कि ऑर्डर किसका है। / The shop needs your name for this order.', variant: 'destructive' })
      return
    }
    const phoneDigits = phone.replace(/[\s\-\u00a0]/g, '').replace(/^\+?91/, '')
    if (!/^[6-9][0-9]{9}$/.test(phoneDigits)) {
      toast({ title: 'मोबाइल नंबर अनिवार्य है / Mobile number is required', description: '10 अंकों का सही मोबाइल नंबर डालें (जैसे 98xxxxxxxx)। / Enter a valid 10-digit mobile number.', variant: 'destructive' })
      return
    }
    setPlacing(true)
    try {
      const res = await fetch(`/api/shops/${slug}/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name.trim(),
          customerPhone: phone,
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
      setUtrSkipped(false)
    } catch (err) {
      toast({ title: 'Submission failed', description: err instanceof Error ? err.message : 'Try again', variant: 'destructive' })
    } finally {
      setSubmittingUtr(false)
    }
  }

  function skipUtr() {
    // Cash / direct UPI at the counter: the shop accepts the payment and starts
    // the print from its dashboard — no UTR needed from the customer.
    setUtrSkipped(true)
    setStage('DONE')
    window.scrollTo({ top: 0 })
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
        onSkip={skipUtr}
        onBack={() => setStage('CONFIG')}
      />
    )
  }

  if (stage === 'DONE' && order) {
    return <DoneStage slug={slug} orderNumber={order.orderNumber} utrSubmitted={!utrSkipped} />
  }

  return (
    // CONFIG stage
    <main className="min-h-screen bg-muted/30 pb-28">
      <header className="bg-background border-b">
        <div className="container max-w-lg mx-auto px-4 py-4">
          <h1 className="font-extrabold text-xl sm:text-2xl leading-tight break-words">{shop.name}</h1>
          {(shop.address || shop.phone) && (
            <p className="text-xs text-muted-foreground mt-0.5">{[shop.address, shop.phone].filter(Boolean).join(' · ')}</p>
          )}
          <ol className="mt-2.5 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
            {[
              { hi: 'फ़ाइल भेजें', en: 'Upload' },
              { hi: 'साइज़ चुनें', en: 'Choose' },
              { hi: 'भुगतान करें', en: 'Pay' },
              { hi: 'दुकान प्रिंट करेगी', en: 'Shop prints' },
            ].map((s, i) => (
              <li key={s.en} className="rounded-full bg-muted px-2 py-0.5 whitespace-nowrap">
                <span className="font-semibold text-foreground">{i + 1}</span> · {s.hi} <span className="hidden min-[400px]:inline">/ {s.en}</span>
              </li>
            ))}
          </ol>
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
              <span className="font-bold text-base sm:text-lg">{uploading ? 'अपलोड हो रहा है… / Uploading…' : 'फ़ाइल चुनें — PDF या फोटो'}</span>
              <span className="text-sm text-muted-foreground">{uploading ? 'Pages counted automatically' : 'यहाँ दबाएँ / Tap here to upload'}</span>
              <span className="text-xs text-muted-foreground">PDF, JPG, PNG · 25 MB तक / up to 25 MB · पन्ने अपने-आप गिने जाएँगे</span>
            </button>
          </CardContent>
        </Card>

        {items.map((item) => {
          const price = priceOf(item)
          const ruleExists = (cm: ColorMode, ps: PaperSize) => pricing.some((p) => p.colorMode === cm && p.paperSize === ps)
          return (
            <Card key={item.key}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start gap-2">
                  {item.mimeType === 'application/pdf' ? (
                    <FileText className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ImageIcon className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-all">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.pageCount} page{item.pageCount > 1 ? 's' : ''} · {(item.sizeBytes / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <a href={item.previewUrl} target="_blank" rel="noreferrer" className="text-xs underline text-muted-foreground shrink-0 py-1">
                    Preview
                  </a>
                  <Button variant="ghost" size="icon" aria-label="Remove file" className="shrink-0" onClick={() => setItems((p) => p.filter((x) => x.key !== item.key))}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>

                <Separator />

                <div>
                  <Label className="text-xs text-muted-foreground">रंग / Colour</Label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {(['BW', 'COLOR'] as ColorMode[]).map((cm) => (
                      <button
                        key={cm}
                        type="button"
                        disabled={!ruleExists(cm, item.paperSize)}
                        onClick={() => patchItem(item.key, { colorMode: cm })}
                        className={`rounded-lg border px-3 py-3 text-sm font-semibold disabled:opacity-40 ${
                          item.colorMode === cm ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                        }`}
                      >
                        {cm === 'BW' ? 'काला-सफ़ेद' : 'रंगीन'}
                        <span className="block text-[10px] font-normal opacity-80">{cm === 'BW' ? 'Black & White' : 'Colour'}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground">कागज़ का साइज़ / Paper size</Label>
                  <div className="grid grid-cols-4 gap-1.5 mt-1">
                    {SIZES.map((ps) => (
                      <button
                        key={ps}
                        type="button"
                        disabled={!ruleExists(item.colorMode, ps)}
                        onClick={() => patchItem(item.key, { paperSize: ps })}
                        className={`rounded-lg border px-1 py-2.5 text-xs sm:text-sm font-medium disabled:opacity-40 ${
                          item.paperSize === ps ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'
                        }`}
                      >
                        {ps}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">कॉपियाँ / Copies</Label>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Decrease copies" onClick={() => patchItem(item.key, { copies: Math.max(1, item.copies - 1) })}>−</Button>
                    <span className="w-10 text-center font-semibold">{item.copies}</span>
                    <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Increase copies" onClick={() => patchItem(item.key, { copies: Math.min(500, item.copies + 1) })}>+</Button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-xs text-muted-foreground">दोनों तरफ़ प्रिंट / Both sides</Label>
                    <p className="text-[11px] text-muted-foreground">सस्ता पड़ता है / Cheaper per page</p>
                  </div>
                  <Switch checked={item.duplex} onCheckedChange={(v) => patchItem(item.key, { duplex: v })} aria-label="Double-sided printing" />
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-muted-foreground">पन्ने / Pages</Label>
                    <div className="flex items-center gap-2 text-sm">
                      <span>सभी / All {item.pageCount}</span>
                      <Switch checked={!item.rangeAll} onCheckedChange={(v) => patchItem(item.key, { rangeAll: !v })} aria-label="Custom page range" />
                      <span>चुनकर / Range</span>
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
              <p className="text-sm font-medium">आपका नाम और मोबाइल नंबर <span className="text-red-600">(अनिवार्य)</span> / Your name & mobile <span className="text-red-600">(required)</span></p>
              <p className="text-[11px] text-muted-foreground -mt-2">ऑर्डर किसका है — दुकान को यह जानकारी ज़रूरी है / The shop needs to know whose order this is</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="cname" className="text-xs">नाम / Name <span className="text-red-600">*</span></Label>
                  <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} placeholder="आपका नाम / Your name" required autoComplete="name" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cphone" className="text-xs">मोबाइल / Mobile <span className="text-red-600">*</span></Label>
                  <Input id="cphone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" inputMode="tel" autoComplete="tel" required />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-[11px] text-muted-foreground">Powered by CopySahaayak</p>
      </div>

      {items.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-safe">
          <div className="container max-w-lg mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] leading-tight text-muted-foreground">कुल / Total ({items.length} फ़ाइल{items.length > 1 ? 'ें' : ''})</p>
              <p className="text-lg sm:text-xl font-bold flex items-center">
                <IndianRupee className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />
                {(total / 100).toFixed(2)}
              </p>
            </div>
            <Button size="lg" className="shrink-0 px-3 sm:px-6 text-sm sm:text-base" onClick={placeOrder} disabled={placing || missingRules}>
              {placing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <Printer className="h-4 w-4 mr-1.5" aria-hidden />}
              <span className="hidden min-[380px]:inline">ऑर्डर दें — भुगतान करें / Place order & pay</span>
              <span className="min-[380px]:hidden">ऑर्डर दें / Order & pay</span>
            </Button>
          </div>
        </div>
      )}
    </main>
  )
}

function PayStage({
  shop, order, utr, setUtr, submitting, onSubmit, onSkip, onBack,
}: {
  shop: ShopInfo
  order: PlacedOrder
  utr: string
  setUtr: (v: string) => void
  submitting: boolean
  onSubmit: () => void
  onSkip: () => void
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
          <ArrowLeft className="h-4 w-4 mr-1" aria-hidden /> Edit order / बदलें
        </Button>
        <Card>
          <CardContent className="pt-6 pb-6 text-center space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Order {order.orderNumber}</p>
              <p className="text-4xl font-bold flex items-center justify-center">
                <IndianRupee className="h-8 w-8" aria-hidden />{(order.totalPaise / 100).toFixed(2)}
              </p>
            </div>
            {order.qrDataUrl && (
              <div className="mx-auto bg-white p-3 rounded-xl w-fit border shadow-sm">
                <img src={order.qrDataUrl} alt={`UPI QR code to pay ₹${(order.totalPaise / 100).toFixed(2)} to ${order.upi.payeeName}`} className="h-56 w-56 sm:h-64 sm:w-64" />
              </div>
            )}
            <ol className="text-left space-y-2 max-w-xs mx-auto" aria-label="Payment steps">
              <li className="flex gap-2.5 text-sm">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-xs">1</span>
                <span>QR को GPay / PhonePe / Paytm से <strong>स्कैन करें</strong><span className="block text-xs text-muted-foreground">Scan the QR with any UPI app — amount is pre-filled</span></span>
              </li>
              <li className="flex gap-2.5 text-sm">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-xs">2</span>
                <span>पूरी रकम भेज दें — पैसा सीधा दुकान के खाते में जाएगा<span className="block text-xs text-muted-foreground">Pay the exact amount — it goes directly to {shop.name} ({order.upi.payeeName})</span></span>
              </li>
              <li className="flex gap-2.5 text-sm">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-xs">3</span>
                <span>पेमेंट होने के बाद UTR डालें — या UTR न हो तो सीधे नीचे वाला बटन दबाएं<span className="block text-xs text-muted-foreground">Enter the UTR after paying — or press the button below if you have none</span></span>
              </li>
            </ol>
            <a href={order.upi.payload} className="block">
              <Button variant="outline" className="w-full h-11">इसी फ़ोन से भुगतान करें — Open UPI app</Button>
            </a>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono text-foreground">{order.upi.vpa}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5"
                onClick={() => {
                  navigator.clipboard?.writeText(order.upi!.vpa).then(
                    () => toast({ title: 'UPI ID copied', description: 'Paste it in any UPI app and pay the exact amount.' }),
                    () => {}
                  )
                }}
              >
                <Copy className="h-3 w-3" aria-hidden /> Copy UPI ID
              </Button>
            </div>
            <Separator />
            <div className="text-left space-y-1.5">
              <Label htmlFor="utr" className="text-sm font-medium">UTR नंबर (ऑप्शनल — न हो तो छोड़ दें) <span className="text-muted-foreground font-normal">/ UTR (optional)</span></Label>
              <Input
                id="utr"
                value={utr}
                onChange={(e) => setUtr(e.target.value.toUpperCase())}
                placeholder="जैसे: 402512345678"
                inputMode="numeric"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                UPI app खोलें → बतियाँ / <strong>History</strong> → दी गई payment → <strong>UTR / UPI Ref No</strong> कॉपी करके यहाँ डालें। दुकान उसी से भुगतान जाँचेगी।
                <span className="block mt-0.5">Find it in your UPI app → History → tap the payment → copy the UTR / reference number.</span>
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
            <Button className="w-full h-12 text-base" size="lg" onClick={onSubmit} disabled={submitting || !utr.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4 mr-2" aria-hidden />}
              मैंने भुगतान कर दिया — I have paid
            </Button>
            <div className="relative text-center">
              <span className="text-[11px] text-muted-foreground bg-background px-2">या / or</span>
            </div>
            <Button variant="outline" className="w-full h-11" onClick={onSkip} disabled={submitting}>
              भुगतान नकद/सीधे दुकान को दिया — UTR के बिना आगे बढ़ें
              <span className="block text-[11px] text-muted-foreground">Paying cash or directly at the shop — continue without a UTR</span>
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}

function DoneStage({ slug, orderNumber, utrSubmitted }: { slug: string; orderNumber: string; utrSubmitted: boolean }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-sm w-full text-center">
        <CardContent className="pt-8 pb-8 space-y-4">
          <CheckCircle2 className="h-12 w-12 mx-auto text-green-600" aria-hidden />
          <div>
            <p className="font-bold text-lg">{utrSubmitted ? 'भेज दिया गया — रेफ़रेंस जमा हो गया' : 'ऑर्डर दुकान को भेज दिया गया'}</p>
            <p className="text-xs text-muted-foreground mb-1">{utrSubmitted ? 'Reference submitted' : 'Order sent to the shop'}</p>
            <p className="text-sm text-muted-foreground">
              {utrSubmitted
                ? <>ऑर्डर <strong>{orderNumber}</strong> — दुकान भुगतान जाँच कर प्रिंट शुरू करेगी। नीचे बटन दबाकर स्थिति देखें।<span className="block mt-0.5">Track live status here — the shop verifies payment, then prints.</span></>
                : <>ऑर्डर <strong>{orderNumber}</strong> — दुकान से भुगतान लेकर वह प्रिंट शुरू करेगी (नकद/सीधे दिया हो तो दुकान accept करेगी)।<span className="block mt-0.5">Order {orderNumber} — the shop accepts your payment (cash/direct) and starts printing.</span></>}
            </p>
          </div>
          <Button asChild className="w-full h-12 text-base">
            <a href={`/s/${slug}/order/${orderNumber}`}>ऑर्डर देखें / Track order</a>
          </Button>
          <Badge variant="outline" className="mx-auto">
            <Clock className="h-3 w-3 mr-1" aria-hidden /> Save this link to check anytime
          </Badge>
        </CardContent>
      </Card>
    </main>
  )
}
