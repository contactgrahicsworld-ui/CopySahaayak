import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { OrderTracker } from '@/components/customer/OrderTracker'

export const dynamic = 'force-dynamic'

export default async function OrderTrackingPage({
  params,
}: {
  params: Promise<{ slug: string; orderNumber: string }>
}) {
  const { slug, orderNumber } = await params
  const shop = await db.shop.findUnique({ where: { slug } })
  if (!shop) notFound()
  return <OrderTracker slug={slug} shopName={shop.name} orderNumber={orderNumber} gatewayEnabled={shop.youpiEnabled} />
}
