import { redirect } from 'next/navigation'
import { getAuthedUser } from '@/lib/auth'
import { SuperDashboard } from '@/components/super/SuperDashboard'

export const dynamic = 'force-dynamic'

export default async function SuperPage() {
  const ctx = await getAuthedUser()
  if (!ctx) redirect('/login?next=/super')
  if (ctx.user.role !== 'SUPER_ADMIN') redirect('/admin')
  return <SuperDashboard user={{ name: ctx.user.name, email: ctx.user.email }} />
}
