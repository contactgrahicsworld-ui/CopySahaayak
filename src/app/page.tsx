import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { QrCode, Printer, ShieldCheck, IndianRupee, FileUp, BellRing, Download, Store } from 'lucide-react'

const steps = [
  { icon: QrCode, title: '1 · Scan shop QR', body: "Customer scans the shop's unique QR — no app install, no signup." },
  { icon: FileUp, title: '2 · Upload & choose', body: 'PDF/images upload instantly. Pages counted server-side. B/W or colour, A4–Legal, copies, duplex, page ranges.' },
  { icon: IndianRupee, title: '3 · Pay by UPI', body: 'Dynamic QR with the exact amount. Customer submits the UTR — no gateway, no commission.' },
  { icon: Printer, title: '4 · Shop prints', body: "Owner verifies the UTR. Verified jobs stream to the shop's Windows connector and print automatically." },
]

const features = [
  { icon: ShieldCheck, title: 'Tenant-isolated by design', body: 'Row-scoped queries, signed private file URLs, device tokens, audit logs. Shop A can never see Shop B.' },
  { icon: BellRing, title: 'Honest printing', body: 'A job is only marked printed after the Windows print spooler confirms it — never on submit.' },
  { icon: Store, title: 'Zero commission', body: "Money goes straight to the shop's UPI. The platform charges a flat subscription, not a cut." },
]

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 min-h-16 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Printer className="h-5 w-5" aria-hidden />
            CopySahaayak
          </div>
          <nav className="flex items-center gap-1.5 flex-wrap">
            <Button asChild variant="ghost" size="sm" className="px-2.5">
              <Link href="/register">Register</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="hidden min-[420px]:inline-flex px-2.5">
              <Link href="/download">Connector</Link>
            </Button>
            <Button asChild size="sm" className="px-2.5">
              <Link href="/login">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="border-b bg-muted/40">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl text-center">
          <Badge variant="outline" className="mb-4">Multi-tenant SaaS · UPI-first · Zero commission</Badge>
          <h1 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">
            Your photocopy shop, open 24×7 — without standing at the counter
          </h1>
          <p className="text-base md:text-lg text-muted-foreground mb-8">
            Customers scan your shop QR, upload files, and pay by UPI. You verify the payment and your
            Windows connector prints the job automatically. No app downloads. No payment gateway. No commissions.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/register">Start free — register your shop →</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href="/login">Shop & platform login</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Customers never need an account — they just scan your shop QR.
          </p>
        </div>
      </section>

      <section className="container mx-auto px-4 py-14">
        <h2 className="text-2xl font-bold mb-8 text-center">How an order flows</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {steps.map((s) => (
            <Card key={s.title}>
              <CardHeader className="pb-2">
                <s.icon className="h-6 w-6 mb-2" aria-hidden />
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{s.body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="container mx-auto px-4 pb-14">
        <div className="grid gap-4 md:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title}>
              <CardHeader className="pb-2">
                <f.icon className="h-6 w-6 mb-2" aria-hidden />
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{f.body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t bg-muted/40">
        <div className="container mx-auto px-4 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-lg">Running a shop?</h3>
            <p className="text-sm text-muted-foreground">Install the Windows connector, map your B/W and colour printers, and start receiving jobs.</p>
          </div>
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link href="/download">
              <Download className="h-4 w-4 mr-2" aria-hidden /> Download connector for Windows
            </Link>
          </Button>
        </div>
      </section>

      <footer className="mt-auto border-t">
        <div className="container mx-auto px-4 py-6 text-sm text-muted-foreground flex flex-col sm:flex-row justify-between gap-2">
          <span>CopySahaayak — Photocopy Shop Automation SaaS</span>
          <span>UPI payments verified manually · No gateway · PostgreSQL-ready multi-tenant architecture</span>
        </div>
      </footer>
    </main>
  )
}
