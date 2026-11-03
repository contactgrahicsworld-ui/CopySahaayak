import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { AdminDashboard } from '@/components/admin/AdminDashboard'

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const ctx = await getAuthedUser()
  if (!ctx) redirect('/login?next=/admin')
  if (ctx.user.role === 'SUPER_ADMIN') redirect('/super')
  if (ctx.user.role !== 'SHOP_ADMIN' || !ctx.user.shopId) redirect('/login?error=forbidden')

  const shop = await db.shop.findUnique({ where: { id: ctx.user.shopId } })
  if (!shop) redirect('/login?error=no-shop')

  return <AdminDashboard user={{ name: ctx.user.name, email: ctx.user.email }} shop={{ id: shop.id, name: shop.name, slug: shop.slug }} />
}
