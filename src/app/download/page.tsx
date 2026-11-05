import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Download, MonitorCheck, TriangleAlert, Trash2, BookOpen } from 'lucide-react'

export const metadata = { title: 'Windows Connector — CopySahaayak' }

const steps = [
  'Download DesktopSahaayak-Setup.exe below.',
  'Double-click the installer. Windows may show a SmartScreen warning because the installer is not code-signed — click "More info" → "Run anyway".',
  'The connector starts automatically after install and lives in your system tray.',
  'In the Shop Admin dashboard open the Printers tab → "Pair connector" and copy the 6-character code (valid 15 minutes).',
  'Enter the code in the connector pairing window, then tag each Windows printer as Black & White or Colour.',
  'Verified orders start printing automatically. A job is confirmed only after the Windows spooler reports it finished.',
]

export default function DownloadPage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 h-14 flex items-center">
          <Link href="/" className="font-bold">CopySahaayak</Link>
        </div>
      </header>
      <div className="container mx-auto px-4 py-10 max-w-2xl flex-1">
        <h1 className="text-2xl font-bold mb-2">Windows Printer Connector</h1>
        <p className="text-muted-foreground mb-6">
          Connects your shop&apos;s Windows PC and printers to CopySahaayak. Self-contained — no Python,
          Node.js, .NET install or command lines required.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <Button asChild size="lg" className="flex-1">
            <a href="/api/downloads/connector" download>
              <Download className="h-4 w-4 mr-2" aria-hidden /> DesktopSahaayak-Setup.exe
            </a>
          </Button>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" aria-hidden /> User Manual — Hindi (उपयोगकर्ता निर्देशिका)</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p className="mb-3">
              Complete 10-page Hindi guide: customer QR ordering, UPI + UTR payment verification, WhatsApp status
              updates, Windows connector installation (SmartScreen-safe), password reset options and FAQ.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button asChild variant="outline" size="sm">
                <a href="/manual/copysahaayak-user-manual-hi.pdf" target="_blank" rel="noopener noreferrer">
                  <BookOpen className="h-4 w-4 mr-2" aria-hidden /> View online
                </a>
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="/manual/copysahaayak-user-manual-hi.pdf" download>
                  <Download className="h-4 w-4 mr-2" aria-hidden /> Download PDF
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Alert className="mb-8">
          <TriangleAlert className="h-4 w-4" />
          <AlertTitle>Unsigned installer</AlertTitle>
          <AlertDescription>
            This build is not code-signed (no certificate authority was available). The SmartScreen warning on
            first run is expected — verify the SHA-256 checksum in the delivery report before running.
          </AlertDescription>
        </Alert>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><MonitorCheck className="h-4 w-4" aria-hidden /> Installation</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 text-sm">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-semibold shrink-0">{i + 1}.</span>
                  <span className="text-muted-foreground">{s}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Trash2 className="h-4 w-4" aria-hidden /> Uninstall</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Settings → Apps → Installed apps → <strong>PrintSahayak Connector</strong> → Uninstall. This removes the
            program, shortcuts, autostart entry and the pairing protocol handler.
          </CardContent>
        </Card>
      </div>
      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Requires Windows 10/11 64-bit · Prints PDF & images · B/W + colour routing · Duplex · Page ranges
      </footer>
    </main>
  )
}
