// Inspect users/shops/orders in the DB (no sensitive fields printed).
import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
try {
  const users = await p.user.findMany({
    select: { email: true, role: true, name: true, isActive: true, shopId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(JSON.stringify(users, null, 1))
  console.log('shops:', await p.shop.count())
  console.log('orders:', await p.order.count())
  console.log('payments:', await p.payment.count())
} finally {
  await p.$disconnect()
}
