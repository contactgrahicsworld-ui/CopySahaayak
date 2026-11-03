import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { CustomerWizard } from '@/components/customer/CustomerWizard'

export const dynamic = 'force-dynamic'

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
