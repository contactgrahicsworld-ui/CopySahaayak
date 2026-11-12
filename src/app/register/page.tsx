'use client'

// Shop owner creation page — deliberately styled like the Super Admin creation
// page (/setup) so the two portals look like siblings of one product. Every new
// shop starts on a 7-day FREE TRIAL; after it ends the owner picks a paid plan
// and pays by UPI straight to the platform (super admin) UPI.
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Store, Loader2, Clock } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

function slugify(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/^-+|-+$/g, '')
}

export default function RegisterPage() {
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shopName, setShopName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [shopPhone, setShopPhone] = useState('')
  const [shopAddress, setShopAddress] = useState('')
  const [upiVpa, setUpiVpa] = useState('')
  const [loading, setLoading] = useState(false)

  const autoSlug = useMemo(() => (slugTouched ? slug : slugify(shopName)), [slug, slugTouched, shopName])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerName,
          email,
          password,
          shopName,
          slug: autoSlug,
          shopPhone: shopPhone || undefined,
          shopAddress: shopAddress || undefined,
          upiVpa: upiVpa || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Registration failed')
      toast.success(`Welcome! Your 7-day free trial has started. Your shop page: /s/${data.shopSlug}`)
      // Hard navigation: the just-created session cookie must be picked up by
      // the dashboard server component — client-router push can silently race.
      window.location.assign('/admin')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Registration failed')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-8 bg-muted/30">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <Store className="h-8 w-8 mx-auto mb-2" aria-hidden />
          <CardTitle className="text-xl">Shop Owner account creation</CardTitle>
          <CardDescription>Apni dukaan register karein — turant 7 din ka free trial shuru</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <Clock className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>
              <b>7 din ka FREE trial</b> — no card needed, sab functions milte hain. Trial khatam hone par apna plan
              chun kar UPI se platform admin ke UPI par pay karein (UTR verify hone par plan activate).
            </span>
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ownerName">Your name</Label>
                <Input id="ownerName" required minLength={2} maxLength={80} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Rajesh Sharma" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shopName">Shop name</Label>
                <Input id="shopName" required minLength={2} maxLength={80} value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Sharma Digital Xerox" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">Shop link (customers open this)</Label>
              <div className="flex items-center gap-1 text-sm">
                <span className="text-muted-foreground whitespace-nowrap">/s/</span>
                <Input id="slug" required value={autoSlug} onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }} placeholder="my-xerox-shop" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Your email (login)</Label>
                <Input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@shop.in" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ chars, letters and digits" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="shopPhone">Shop phone (optional)</Label>
                <Input id="shopPhone" type="tel" value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} placeholder="+91-98…" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="upiVpa">UPI ID for payments (optional)</Label>
                <Input id="upiVpa" value={upiVpa} onChange={(e) => setUpiVpa(e.target.value)} placeholder="name@okhdfcbank" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shopAddress">Shop address (optional)</Label>
              <Input id="shopAddress" value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} placeholder="Shop 12, MG Road, Pune" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Create my shop — start 7-day free trial
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Account banate hi aap <Link href="/terms" className="underline">Terms of Service</Link> aur <Link href="/privacy" className="underline">Privacy Policy</Link> se sehmat hote hain — ek baar padh lein, simple Hinglish me likhi hai.
          </p>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Pehle se account hai? <Link href="/login" className="underline">Shop Owner sign in</Link> · Forgot password? <Link href="/forgot-password" className="underline">Reset it</Link>
          </p>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Platform owner (Super Admin)? Home page par <b>“Super Admin”</b> button use karein — dukaan account alag hai ·
            <Link href="/" className="underline"> Back to home</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
