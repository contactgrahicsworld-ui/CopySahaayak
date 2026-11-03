// Check: does a SUPER_ADMIN exist in prod? Which users exist at all?
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
try {
  const users = await db.user.findMany({
    select: { email: true, role: true, isActive: true, createdAt: true, shop: { select: { slug: true } } },
    orderBy: { createdAt: 'asc' },
  })
  console.log('=== Users in prod DB ===')
  for (const u of users) console.log(u.role.padEnd(12), u.email, '| active:', u.isActive, '| shop:', u.shop?.slug || '-')
} finally { await db.$disconnect() }
