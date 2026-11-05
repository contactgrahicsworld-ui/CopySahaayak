// One-off surgical cleanup: removes ALL test artifacts created during the live
// audit of 2026-11-05 from the REAL shop "mansa" (id cmw0kht360004l907yw48iavf)
// and restores its subscription to the pre-test FREE plan. Also removes the
// leftover local-audit shops. Idempotent: every delete is scoped and tolerant.
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const SHOP = 'cmw0kht360004l907yw48iavf' // mansa — real shop
const ORDER_NUMBERS = ['PC-2611-0365C', 'PC-2611-0LNHD']

async function main() {
  console.log('--- restore mansa subscription to FREE (pre-test state) ---')
  const freePlan = await db.plan.findUnique({ where: { code: 'FREE' } })
  if (!freePlan) throw new Error('FREE plan missing')
  const sub = await db.subscription.findUnique({ where: { shopId: SHOP } })
  if (sub) {
    await db.subscription.update({
      where: { shopId: SHOP },
      data: { planId: freePlan.id, status: 'ACTIVE', startsAt: new Date('2026-11-03T10:51:07.657Z'), expiresAt: new Date('2046-11-28T10:51:07.657Z') },
    })
    console.log('subscription restored: plan=FREE expires=2046-11-28')
  }

  console.log('--- delete test subscription payment (UTR 409998887777) ---')
  const sp = await db.subscriptionPayment.deleteMany({ where: { shopId: SHOP, utr: '409998887777' } })
  console.log('subscriptionPayments deleted:', sp.count)

  console.log('--- delete test notifications ---')
  const notes = await db.notification.deleteMany({
    where: { shopId: SHOP, OR: [{ title: { contains: 'STARTER' } }, { title: { contains: 'New order' } }, { title: { contains: 'Payment submitted' } }] },
  })
  console.log('notifications deleted:', notes.count)

  console.log('--- delete audit test orders + children ---')
  for (const num of ORDER_NUMBERS) {
    const order = await db.order.findFirst({ where: { orderNumber: num, shopId: SHOP } })
    if (!order) { console.log(num, 'not found — skip'); continue }
    const items = await db.orderItem.findMany({ where: { orderId: order.id } })
    for (const item of items) {
      await db.printEvent.deleteMany({ where: { printJob: { orderItemId: item.id } } })
      await db.printJob.deleteMany({ where: { orderItemId: item.id } })
    }
    const docs = await db.document.findMany({ where: { orderId: order.id }, select: { id: true, storedPath: true } })
    await db.paymentVerification.deleteMany({ where: { payment: { orderId: order.id } } })
    await db.payment.deleteMany({ where: { orderId: order.id } })
    await db.orderItem.deleteMany({ where: { orderId: order.id } })
    await db.order.delete({ where: { id: order.id } })
    for (const d of docs) {
      await db.document.delete({ where: { id: d.id } }).catch(() => {})
      console.log('doc', d.id, d.storedPath)
    }
    console.log('order', num, 'removed')
  }

  console.log('--- delete unlinked test documents (audit uploads) ---')
  const strayDocs = await db.document.findMany({ where: { shopId: SHOP, orderId: null, originalName: 'test-doc.pdf' } })
  for (const d of strayDocs) { await db.document.delete({ where: { id: d.id } }).catch(() => {}) }
  console.log('stray docs deleted:', strayDocs.length)

  console.log('--- delete simulated device + its printers ---')
  const dev = await db.device.findFirst({ where: { shopId: SHOP, machineName: 'SHOP-PC-TEST' } })
  if (dev) {
    const pr = await db.printer.deleteMany({ where: { deviceId: dev.id } })
    await db.device.delete({ where: { id: dev.id } })
    console.log('device SHOP-PC-TEST removed with', pr.count, 'printer(s)')
  } else {
    console.log('simulated device not found — skip')
  }

  console.log('--- delete guest customer sessions created by tests ---')
  const cs = await db.customerSession.deleteMany({ where: { shopId: SHOP } })
  console.log('customer sessions deleted:', cs.count)

  console.log('--- remove leftover local audit shops ---')
  for (const slug of ['audit-local-1', 'audit-local-r2']) {
    const shop = await db.shop.findUnique({ where: { slug } })
    if (!shop) { console.log(slug, 'not present'); continue }
    const users = await db.user.findMany({ where: { shopId: shop.id }, select: { id: true } })
    const userIds = users.map((u) => u.id)
    await db.printEvent.deleteMany({ where: { shopId: shop.id } })
    await db.printJob.deleteMany({ where: { shopId: shop.id } })
    await db.notification.deleteMany({ where: { shopId: shop.id } })
    const pays = await db.payment.findMany({ where: { shopId: shop.id }, select: { id: true } })
    await db.paymentVerification.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } })
    await db.payment.deleteMany({ where: { shopId: shop.id } })
    await db.orderItem.deleteMany({ where: { shopId: shop.id } })
    await db.order.deleteMany({ where: { shopId: shop.id } })
    await db.document.deleteMany({ where: { shopId: shop.id } })
    await db.customerSession.deleteMany({ where: { shopId: shop.id } })
    await db.printer.deleteMany({ where: { shopId: shop.id } })
    await db.device.deleteMany({ where: { shopId: shop.id } })
    await db.routingRule.deleteMany({ where: { shopId: shop.id } })
    await db.pricingRule.deleteMany({ where: { shopId: shop.id } })
    await db.shopMember.deleteMany({ where: { shopId: shop.id } })
    await db.subscriptionPayment.deleteMany({ where: { shopId: shop.id } })
    await db.subscription.deleteMany({ where: { shopId: shop.id } })
    await db.session.deleteMany({ where: { userId: { in: userIds } } })
    await db.user.deleteMany({ where: { shopId: shop.id } })
    await db.auditLog.deleteMany({ where: { shopId: shop.id } })
    await db.shop.delete({ where: { id: shop.id } })
    console.log(slug, 'deleted')
  }

  console.log('--- verify final state ---')
  const shop = await db.shop.findUnique({ where: { id: SHOP }, include: { subscription: { include: { plan: true } }, _count: { select: { orders: true, devices: true, printers: true } } } })
  console.log('mansa plan:', shop.subscription?.plan?.code, '| status:', shop.subscription?.status, '| expires:', shop.subscription?.expiresAt?.toISOString().slice(0, 10))
  console.log('orders:', shop._count.orders, '| devices:', shop._count.devices, '| printers:', shop._count.printers)
  console.log('upiVpa:', shop.upiVpa, '| payee:', shop.upiPayeeName)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => db.$disconnect())
