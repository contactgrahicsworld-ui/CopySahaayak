import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  QrCode,
  Printer,
  ShieldCheck,
  IndianRupee,
  FileUp,
  BellRing,
  Download,
  Store,
  MonitorDown,
  CheckCircle2,
  TriangleAlert,
  BookOpen,
} from 'lucide-react'

export const revalidate = 3600

type ReleaseInfo = { version: string | null; sizeMb: string | null }

async function getLatestRelease(): Promise<ReleaseInfo> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/contactgrahicsworld-ui/CopySahaayak/releases/latest',
      { headers: { Accept: 'application/vnd.github+json' }, next: { revalidate: 3600 } },
    )
    if (!res.ok) return { version: null, sizeMb: null }
    const data = (await res.json()) as {
      tag_name?: string
      assets?: { name?: string; size?: number }[]
    }
    const version = typeof data.tag_name === 'string' ? data.tag_name.replace(/^connector-v?/, '') : null
    const asset = (data.assets ?? []).find((a) => a.name === 'DesktopSahaayak-Setup.exe')
    const sizeMb = asset?.size ? (asset.size / (1024 * 1024)).toFixed(0) : null
    return { version, sizeMb }
  } catch {
    return { version: null, sizeMb: null }
  }
}

const steps = [
  {
    icon: QrCode,
    title: 'Customer scans your QR',
    body: 'No app, no signup for the customer. Your unique QR sits at the counter.',
  },
  {
    icon: FileUp,
    title: 'Upload & choose options',
    body: 'PDF or images, B/W or colour, A4–Legal, copies, duplex, page ranges. Pages are counted automatically.',
  },
  {
    icon: IndianRupee,
    title: 'Pay by UPI — direct to you',
    body: 'A dynamic QR with the exact amount. Customer submits the UTR, you verify it. Money never passes through us.',
  },
  {
    icon: Printer,
    title: 'Job prints automatically',
    body: 'Once you verify the payment, the job appears on your shop PC and prints itself. “Printed” is confirmed by the real print spooler.',
  },
]

const features = [
  {
    icon: ShieldCheck,
    title: 'Your data stays yours',
    body: 'Every shop is fully isolated — one shop can never see another shop’s orders, files or customers.',
  },
  {
    icon: BellRing,
    title: 'Honest printing status',
    body: 'A job is only marked printed after the Windows print spooler confirms it — never on submit.',
  },
  {
    icon: Store,
    title: 'Zero commission',
    body: 'UPI payments go straight to your own account. The platform charges a flat subscription, not a cut.',
  },
]

const installSteps = [
  'Run DesktopSahaayak-Setup.exe — Windows SmartScreen may appear (our installer is unsigned): click “More info” → “Run anyway”.',
  'The app sits quietly in your system tray after install — no setup needed.',
  'In your dashboard open Printers → “Pair connector”, enter the 6-character code, then tick which printer is B/W and which is Colour.',
]

export default async function Home() {
  const release = await getLatestRelease()
  const versionLabel = release.version ? `v${release.version}` : 'Latest'

  return (
    <main className="min-h-screen flex flex-col scroll-smooth">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Printer className="h-4.5 w-4.5" aria-hidden />
            </span>
            CopySahaayak
          </Link>
          <nav aria-label="Main" className="hidden md:flex items-center gap-1 text-sm">
            <Link href="#how" className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              How it works
            </Link>
            <Link href="#download" className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              Desktop app
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">Start free</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b bg-gradient-to-b from-muted/60 to-background">
        <div className="container mx-auto px-4 py-16 md:py-24 max-w-3xl text-center">
          <Badge variant="outline" className="mb-5 bg-background">
            Multi-tenant SaaS · UPI-first · Zero commission
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-4 text-balance">
            Your photocopy shop, open <span className="text-emerald-600">24×7</span> — without standing at the counter
          </h1>
          <p className="text-base md:text-lg text-muted-foreground mb-8 text-pretty">
            Customers scan your shop QR, upload files and pay by UPI. You verify the payment — your Windows
            PC prints the job automatically. No app for customers. No payment gateway. No commission.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/register">Start free — register your shop</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href="#download">
                <MonitorDown className="h-4 w-4 mr-2" aria-hidden /> Desktop app
              </Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-5">
            Customers never need an account — they just scan your shop QR.
          </p>
        </div>
      </section>

      {/* Download — the single download place for Desktop Sahaayak */}
      <section id="download" className="container mx-auto px-4 py-14 scroll-mt-20" aria-labelledby="download-heading">
        <div className="rounded-2xl border bg-gradient-to-b from-muted/60 to-background p-6 md:p-10 max-w-3xl mx-auto">
          <div className="text-center mb-8">
            <h2 id="download-heading" className="text-2xl md:text-3xl font-bold tracking-tight mb-2">
              Desktop Sahaayak for Windows
            </h2>
            <p className="text-muted-foreground text-sm md:text-base">
              One small app on your shop PC. It receives verified orders and prints them — PDFs, images,
              B/W and colour routing, duplex, page ranges.
            </p>
          </div>

          <div className="flex flex-col items-center gap-4">
            <Button asChild size="lg" className="h-12 px-8 text-base w-full sm:w-auto">
              <a href="/api/downloads/connector" download>
                <Download className="h-5 w-5 mr-2" aria-hidden /> Download for Windows
              </a>
            </Button>
            <p className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <Badge variant="secondary" className="font-mono">{versionLabel}</Badge>
              {release.sizeMb && <span>· {release.sizeMb} MB</span>}
              <span>· Windows 10/11 (64-bit)</span>
              <span>· Free with every plan</span>
            </p>
          </div>

          <ol className="mt-8 space-y-3 max-w-xl mx-auto">
            {installSteps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700 font-semibold text-xs">
                  {i + 1}
                </span>
                <span className="text-muted-foreground">{s}</span>
              </li>
            ))}
          </ol>

          <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground max-w-xl mx-auto">
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
            <span>
              Reinstalling over an older version keeps your pairing — no need to pair again. To remove it:
              Settings → Apps → Installed apps → PrintSahayak Connector.
            </span>
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="container mx-auto px-4 py-14 scroll-mt-20" aria-labelledby="how-heading">
        <div className="text-center mb-10">
          <h2 id="how-heading" className="text-2xl md:text-3xl font-bold tracking-tight">
            How an order flows
          </h2>
          <p className="text-muted-foreground mt-2 text-sm md:text-base">Four steps. No new habits for your customers.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {steps.map((s) => (
            <Card key={s.title} className="h-full">
              <CardHeader className="pb-2">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 mb-2">
                  <s.icon className="h-5 w-5" aria-hidden />
                </span>
                <CardTitle className="text-base leading-snug">{s.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{s.body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="container mx-auto px-4 pb-14" aria-label="Why CopySahaayak">
        <div className="grid gap-4 md:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="h-full">
              <CardHeader className="pb-2">
                <f.icon className="h-5 w-5 mb-2 text-emerald-700" aria-hidden />
                <CardTitle className="text-base">{f.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{f.body}</CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="border-t bg-muted/40">
        <div className="container mx-auto px-4 py-12 text-center max-w-2xl">
          <h3 className="text-xl md:text-2xl font-bold tracking-tight mb-2">Ready in one evening</h3>
          <p className="text-sm md:text-base text-muted-foreground mb-6">
            Register your shop, print your QR, install Desktop Sahaayak and tag your printers. That’s the whole setup.
          </p>
          <Button asChild size="lg">
            <Link href="/register">Start free — register your shop</Link>
          </Button>
          <p className="mt-4 text-xs text-muted-foreground flex items-center justify-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
            Free plan available · No card needed
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t">
        <div className="container mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">CopySahaayak — Photocopy Shop Automation SaaS</span>
          <nav aria-label="Footer" className="flex items-center gap-2 flex-wrap justify-center">
            <Button asChild variant="ghost" size="sm">
              <a href="/manual/copysahaayak-user-manual-hi.pdf" target="_blank" rel="noopener">
                <BookOpen className="h-4 w-4 mr-1.5" aria-hidden /> User Manual (हिंदी)
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/super">
                <ShieldCheck className="h-4 w-4 mr-1.5" aria-hidden /> Super Admin
              </Link>
            </Button>
          </nav>
        </div>
        <p className="container mx-auto px-4 pb-4 text-xs text-muted-foreground text-center sm:text-left">
          UPI payments verified manually · No gateway · Multi-tenant architecture
        </p>
      </footer>
    </main>
  )
}
