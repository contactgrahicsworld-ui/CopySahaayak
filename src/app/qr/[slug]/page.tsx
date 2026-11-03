import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { headers } from 'next/headers'
import QRCode from 'qrcode'
import { PrintButton } from '@/components/customer/PrintButton'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Shop counter sign — CopySahaayak' }

// Printable A4 counter sign: shop name + scan-to-order QR + 4-step instructions.
// The owner prints this once; customers scan it to start ordering.
export default async function QrSignPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const shop = await db.shop.findUnique({
    where: { slug },
    select: { name: true, slug: true, address: true, phone: true, isActive: true, subscription: { select: { status: true } } },
  })
  if (!shop || !shop.isActive || !shop.subscription || !['ACTIVE', 'PENDING_VERIFICATION'].includes(shop.subscription.status)) {
    notFound()
  }

  const h = await headers()
  const proto = h.get('x-forwarded-proto') || 'https'
  const host = h.get('x-forwarded-host') || h.get('host') || 'copysahaayak.vercel.app'
  const orderUrl = `${proto}://${host}/s/${shop.slug}`

  const qrDataUrl = await QRCode.toDataURL(orderUrl, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 640,
    color: { dark: '#111111', light: '#FFFFFF' },
  })

  const steps = [
    'Scan the QR with your phone camera',
    'Upload your PDF or photos',
    'Choose copies, size & colour',
    'Pay by UPI — shop prints your job',
  ]

  return (
    <main className="min-h-screen bg-neutral-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto w-[210mm] max-w-full bg-white shadow-lg print:shadow-none" style={{ minHeight: '290mm' }}>
        <div className="flex flex-col items-center text-center px-10 py-12 h-full" style={{ minHeight: '290mm' }}>
          <p className="text-xs tracking-[0.3em] text-neutral-500 uppercase">Print orders online</p>
          <h1 className="mt-3 text-5xl font-extrabold tracking-tight text-neutral-900 break-words max-w-full">{shop.name}</h1>
          {(shop.address || shop.phone) && (
            <p className="mt-3 text-base text-neutral-600">
              {[shop.address, shop.phone].filter(Boolean).join(' · ')}
            </p>
          )}

          <div className="mt-10 border-4 border-neutral-900 rounded-2xl p-5 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrDataUrl} alt={`QR code — order prints online from ${shop.name}`} className="w-[72mm] h-[72mm]" />
          </div>
          <p className="mt-5 text-2xl font-bold text-neutral-900">Scan to place a print order</p>
          <p className="mt-1 text-sm text-neutral-500 break-all">{orderUrl}</p>

          <ol className="mt-10 w-full max-w-[150mm] space-y-3 text-left">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-sm font-bold text-white">{i + 1}</span>
                <span className="text-lg text-neutral-800">{s}</span>
              </li>
            ))}
          </ol>

          <div className="mt-auto pt-10 flex flex-col items-center gap-2">
            <PrintButton />
            <p className="text-[11px] text-neutral-400">
              Powered by CopySahaayak · {host}
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
