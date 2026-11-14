// Shop Admin: YouPI PG gateway configuration for CUSTOMER → SHOP order
// payments. The shop registers itself as a merchant on the platform owner's
// YouPI server (receiving account = the shop's own UPI), then pastes the
// merchant credentials here. Secrets are write-only (masked on read).
// When enabled, customers see "Online Pay karein — UPI Gateway" on the order
// page; the signed webhook auto-verifies the payment and print jobs queue
// immediately — no manual UTR checking.
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2, Wallet } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

type ShopData = {
  youpiEnabled: boolean
  youpiMerchantId: string
  youpiApiKey: string
  youpiWebhookSecret: string
  youpiPublicKey: string
}

export function ShopGatewayCard() {
  const { toast } = useToast()
  const [cfg, setCfg] = useState<ShopData>({ youpiEnabled: false, youpiMerchantId: '', youpiApiKey: '', youpiWebhookSecret: '', youpiPublicKey: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/admin/shop', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.shop) {
          setCfg({
            youpiEnabled: Boolean(d.shop.youpiEnabled),
            youpiMerchantId: d.shop.youpiMerchantId || '',
            youpiApiKey: d.shop.youpiApiKey || '',
            youpiWebhookSecret: d.shop.youpiWebhookSecret || '',
            youpiPublicKey: d.shop.youpiPublicKey || '',
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/admin/shop', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Save failed')
      toast({ title: 'Gateway settings saved', description: cfg.youpiEnabled ? 'Customers ab "Online Pay" button dekhenge' : 'Gateway customers ke liye off hai' })
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : '', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Wallet className="h-4 w-4" aria-hidden /> Online Payment Gateway (customer payments)</CardTitle>
        <CardDescription>
          Aapke customer order page se GPay/PhonePe/Paytm se pay karenge. Payment gateway verify karte hi order apne-aap CONFIRM ho jayega aur print jobs queue ho jayenge — UTR manually check karne ki zaroorat nahi.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <form onSubmit={save} className="space-y-3">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor="youpi-enabled" className="text-sm">Gateway ON karein</Label>
                <p className="text-xs text-muted-foreground">OFF rahne par customers UPI QR + UTR tarika dekhenge (jo abhi chal raha hai).</p>
              </div>
              <Switch id="youpi-enabled" checked={cfg.youpiEnabled} onCheckedChange={(v) => setCfg({ ...cfg, youpiEnabled: v })} />
            </div>
            <div className="space-y-1">
              <Label>Gateway Merchant ID (aapki shop ka merchant)</Label>
              <Input value={cfg.youpiMerchantId} onChange={(e) => setCfg({ ...cfg, youpiMerchantId: e.target.value })} placeholder="YouPI admin me aapki shop ka merchant ID" />
            </div>
            <div className="space-y-1">
              <Label>Gateway API key (server-only)</Label>
              <Input value={cfg.youpiApiKey} onChange={(e) => setCfg({ ...cfg, youpiApiKey: e.target.value })} placeholder={cfg.youpiApiKey || 'YouPI merchant API key'} />
            </div>
            <div className="space-y-1">
              <Label>Gateway webhook secret (server-only)</Label>
              <Input value={cfg.youpiWebhookSecret} onChange={(e) => setCfg({ ...cfg, youpiWebhookSecret: e.target.value })} placeholder={cfg.youpiWebhookSecret || 'YouPI merchant webhook secret'} />
            </div>
            <div className="space-y-1">
              <Label>Gateway public key</Label>
              <Input value={cfg.youpiPublicKey} onChange={(e) => setCfg({ ...cfg, youpiPublicKey: e.target.value })} placeholder="YouPI merchant public key" />
              <p className="text-xs text-muted-foreground">Ye credentials platform owner aapko dega (YouPI admin me aapki shop ka merchant banwakar, receiving account = aapka apna UPI).</p>
            </div>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden />}Save gateway settings</Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
