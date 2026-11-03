import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { CustomerWizard } from '@/components/customer/CustomerWizard'

export const dynamic = 'force-dynamic'

// Shop-name branding: the browser tab / share preview carries the shop's own
// name, not the platform name — the QR feels like the shop's own page.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  try {
    const shop = await db.shop.findUnique({
      where: { slug },
      select: { name: true, address: true },
    })
    if (shop) {
      return {
        title: `${shop.name} — Print Orders Online`,
        description: `Upload files, choose copies & paper size, pay by UPI and get prints at ${shop.name}${shop.address ? `, ${shop.address}` : ''}. No app needed.`,
      }
    }
  } catch {
    // fall through to default metadata
  }
  return { title: 'Print Orders Online' }
}

export default async function ShopOrderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const shop = await db.shop.findUnique({
    where: { slug },
    include: { pricingRules: { where: { isActive: true } }, subscription: true },
  })
  if (!shop || !shop.isActive || !shop.subscription || !['ACTIVE', 'PENDING_VERIFICATION'].includes(shop.subscription.status)) {
    notFound()
  }

  return (
    <CustomerWizard
      shop={{
        name: shop.name,
        slug: shop.slug,
        phone: shop.phone,
        address: shop.address,
        upiConfigured: !!shop.upiVpa,
      }}
      pricing={shop.pricingRules.map((r) => ({
        paperSize: r.paperSize as import('@/lib/constants').PaperSize,
        colorMode: r.colorMode as import('@/lib/constants').ColorMode,
        singleSidedPaise: r.singleSidedPaise,
        duplexPaise: r.duplexPaise,
      }))}
    />
  )
}
