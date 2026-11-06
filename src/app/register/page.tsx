'use client'

// Shop self-registration: creates the shop + owner account and signs in.
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Store, Loader2 } from 'lucide-react'
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
      toast.success(`Welcome! Your shop page: /s/${data.shopSlug}`)
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
          <CardTitle className="text-xl">Register your photocopy shop</CardTitle>
          <CardDescription>Free plan, no card needed. You can change everything later.</CardDescription>
        </CardHeader>
        <CardContent>
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
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}Create my shop
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-4 text-center">
            Already registered? <Link href="/login" className="underline">Sign in</Link> · Forgot password? <Link href="/forgot-password" className="underline">Reset it</Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
