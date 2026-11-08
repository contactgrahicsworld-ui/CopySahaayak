import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { SuperDashboard } from '@/components/super/SuperDashboard'

export const dynamic = 'force-dynamic'

export default async function SuperPage() {
  const ctx = await getAuthedUser()
  if (!ctx) redirect('/super/login')
  // A signed-in non-super (usually the shop owner) must never land here silently —
  // tell the shop dashboard to explain exactly why it opened instead.
  if (ctx.user.role !== 'SUPER_ADMIN') redirect('/admin?notice=super-only')
  return <SuperDashboard user={{ name: ctx.user.name, email: ctx.user.email }} />
}
