// POSITIVE-path verification of the gateway fail-safe additions, run LOCALLY
// against the REAL production database with temp fixtures (cleaned up after):
//   1. Pull reconciliation (webhook-missed recovery): a mock YouPI gateway on
//      localhost reports RECONCILED → the real reconcile lib advances the temp
//      order payment: VERIFIED(GATEWAY) + order CONFIRMED + print job queued.
//   2. Subscription pull reconciliation: mock says paid → plan auto-activates.
//   3. Double-extension guard: TWO concurrent advance calls for the same
//      subscription payment must extend expiry exactly ONCE (atomic claim).
//   4. Double fan-out guard: two concurrent advances for the same order must
//      queue exactly one print job per item (DB unique constraint).
//   5. Throttle: a second reconcile within 20 s must NOT call the gateway
//      (checked:false) and must not double-advance.
//   6. REJECTED-but-paid: a cancelled/rejected payment whose webhook later
//      proves money arrived must still advance (customer can never lose money).
//   7. Negative pulls: gateway unreachable / non-credit response → no advance,
//      polling endpoint logic unaffected (checked:true, advanced:false).
// Run: node --import tsx scripts/verify-reconcile-positive.mts
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { PrismaClient } from '@prisma/client'

console.log('boot: reconcile-positive starting…')

const fs = await import('node:fs')
// The @/lib/* modules construct their own PrismaClient from env() — point it
// at the same production DB the fixtures use, BEFORE those modules load.
let url = fs.readFileSync('/tmp/dburl.txt', 'utf8').trim()
if (!url.includes('schema=')) url += (url.includes('?') ? '&' : '?') + 'schema=csp'
process.env.DATABASE_URL = url
if (fs.existsSync('/tmp/directurl.txt')) {
  let durl = fs.readFileSync('/tmp/directurl.txt', 'utf8').trim()
  if (!durl.includes('schema=')) durl += (durl.includes('?') ? '&' : '?') + 'schema=csp'
  process.env.DIRECT_URL = durl
}
const db = new PrismaClient({ datasources: { db: { url } } })

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) process.exitCode = 1
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Mock YouPI gateway: GET /api/v1/payments/:id → JSON the platform accepts.
// mode: 'paid' = RECONCILED with exact amount; 'echo' = JSON without credit fields.
function startMockGateway(paymentAmounts: Record<string, number>, mode: 'paid' | 'echo'): Promise<Server> {
  const server = createServer((req, res) => {
    const id = decodeURIComponent((req.url || '').split('/').pop() || '')
    res.setHeader('Content-Type', 'application/json')
    if (mode === 'echo') {
      res.end(JSON.stringify({ object: 'echo', note: 'no credit-event fields here' }))
      return
    }
    const paise = paymentAmounts[id]
    if (paise === undefined) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: 'unknown payment' }))
      return
    }
    res.end(JSON.stringify({
      id, paymentId: id, event: 'RECONCILED', settlementState: 'RECONCILED', method: 'UPI',
      amount: (paise / 100).toFixed(2), amountPaise: paise, utr: `4099${String(paise).padStart(8, '0')}`,
      status: 'RECONCILED', timestamp: Date.now(),
    }))
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

async function main() {
  const TAG = `gwr-${Date.now().toString(36)}`
  const secret = `whsec_${randomBytes(12).toString('hex')}`

  // ---------- sweep leftovers from a crashed earlier run ----------
  const staleShops = await db.shop.findMany({ where: { slug: { startsWith: 'gwr-' } }, select: { id: true } })
  for (const s of staleShops) {
    console.log(`sweep: deleting stale gwr shop ${s.id}`)
    const pids = (await db.payment.findMany({ where: { shopId: s.id } })).map((p) => p.id)
    const spids = (await db.subscriptionPayment.findMany({ where: { shopId: s.id } })).map((r) => r.id)
    await db.gatewayEvent.deleteMany({ where: { OR: [{ targetId: { in: pids } }, { targetId: { in: spids } }] } }).catch(() => null)
    await db.subscriptionPayment.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.subscription.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.printEvent.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.printJob.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.routingRule.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.printer.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.orderItem.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.paymentVerification.deleteMany({ where: { paymentId: { in: pids } } }).catch(() => null)
    await db.payment.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.order.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    const docs = await db.document.findMany({ where: { shopId: s.id }, select: { storedPath: true } })
    await db.document.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.storedObject.deleteMany({ where: { key: { in: docs.map((d) => d.storedPath) } } }).catch(() => null)
    await db.customerSession.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.notification.deleteMany({ where: { shopId: s.id } }).catch(() => null)
    await db.shop.delete({ where: { id: s.id } }).catch(() => null)
  }
  await db.platformSetting.deleteMany({ where: { key: { startsWith: 'youpi_' } } })

  // ---------- temp fixtures ----------
  const shop = await db.shop.create({ data: { slug: TAG, name: 'GWR Shop', upiVpa: 'e2e@upi', upiPayeeName: 'GWR', isActive: true } })
  await db.shop.update({ where: { id: shop.id }, data: { youpiEnabled: true, youpiMerchantId: 'mrc_gwr', youpiApiKey: 'ak_gwr', youpiWebhookSecret: secret, youpiPublicKey: 'pk_gwr' } })
  const printer = await db.printer.create({ data: { shopId: shop.id, windowsName: 'GWR Printer', colorMode: 'ANY', paperSizesJson: '["A4"]', status: 'ONLINE' } })
  const cs = await db.customerSession.create({ data: { shopId: shop.id, tokenHash: randomBytes(32).toString('hex'), name: 'GWR Customer' } })
  const so = await db.storedObject.create({ data: { key: `uploads/${shop.id}/gwr.pdf`, mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4 gwr'), sizeBytes: 14 } })
  const doc = await db.document.create({ data: { shopId: shop.id, customerSessionId: cs.id, originalName: 'gwr.pdf', storedPath: so.key, mimeType: 'application/pdf', sizeBytes: 14, pageCount: 1, status: 'READY', checksum: 'gwr' } })
  const order = await db.order.create({ data: { shopId: shop.id, customerSessionId: cs.id, orderNumber: `GWR-${randomBytes(3).toString('hex').toUpperCase()}`, status: 'PENDING_PAYMENT', totalPaise: 250 } })
  const item = await db.orderItem.create({ data: { orderId: order.id, shopId: shop.id, documentId: doc.id, colorMode: 'BW', paperSize: 'A4', duplex: false, copies: 1, pageCount: 1, unitPricePaise: 250, totalPaise: 250 } })
  const payment = await db.payment.create({ data: { orderId: order.id, shopId: shop.id, method: 'UPI', amountPaise: 250, upiVpa: 'e2e@upi', qrPayload: 'upi://gwr', txnRef: order.orderNumber, status: 'PENDING', gatewayRef: `gw-pay-${randomUUID()}` } })
  const plan = (await db.plan.findMany({ where: { isActive: true, pricePaise: { gt: 0 } }, orderBy: { pricePaise: 'asc' } }))[0]
  const subPay = await db.subscriptionPayment.create({ data: { shopId: shop.id, planId: plan.id, amountPaise: plan.pricePaise, utr: null, status: 'PENDING', gatewayRef: `gw-sub-${randomUUID()}` } })

  const server = await startMockGateway({ [payment.gatewayRef!]: 250, [subPay.gatewayRef!]: plan.pricePaise, [`gw-pay-rejected`]: 250 }, 'paid')
  const port = (server.address() as { port: number }).port
  const gatewayUrl = `http://127.0.0.1:${port}`
  console.log(`mock gateway at ${gatewayUrl}, fixtures shop=${TAG} order=${order.orderNumber}`)

  // Platform settings must point at the mock for both scopes (order scope
  // inherits apiUrl from platform; sub scope uses it directly).
  const created = [
    ['youpi_api_url', gatewayUrl], ['youpi_merchant_id', 'mrc_platform_gwr'],
    ['youpi_merchant_api_key', 'ak_platform_gwr'], ['youpi_webhook_secret', secret],
  ]
  for (const [k, v] of created) await db.platformSetting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } })

  // Import the REAL production code (tsx resolves the @/ alias from tsconfig).
  const { reconcileOrderPaymentFromGateway, reconcileSubscriptionPaymentFromGateway } = await import('../src/lib/gateway-reconcile')
  const { advanceOrderPaymentByGateway, advanceSubscriptionByGateway } = await import('../src/lib/gateway-verify')

  // ---------- 7. negative pulls first (before anything advances) ----------
  // Point the shared gateway URL at a dead port: no advance, no throw, and the
  // throttle stamp is still written (a dead gateway must not be hammered).
  await db.platformSetting.update({ where: { key: 'youpi_api_url' }, data: { value: 'http://127.0.0.1:9' } })
  const unreachable2 = await reconcileOrderPaymentFromGateway(payment.id)
  check('order: gateway unreachable → no advance, no throw', unreachable2.checked === true && unreachable2.advanced === false, JSON.stringify(unreachable2))
  const p1 = await db.payment.findUnique({ where: { id: payment.id }, select: { status: true, gatewayCheckedAt: true } })
  check('order: throttle stamp set even on unreachable gateway', p1?.status === 'PENDING' && p1.gatewayCheckedAt !== null, String(p1?.gatewayCheckedAt))

  // ---------- 1. positive pull reconciliation (order) ----------
  await db.platformSetting.update({ where: { key: 'youpi_api_url' }, data: { value: gatewayUrl } })
  // The unreachable-negative test stamped the throttle; clear it so the
  // positive pull is allowed through immediately.
  await db.payment.update({ where: { id: payment.id }, data: { gatewayCheckedAt: null } })
  const rec1 = await reconcileOrderPaymentFromGateway(payment.id)
  check('order: pull reconcile advances on RECONCILED + exact amount', rec1.checked === true && rec1.advanced === true, JSON.stringify(rec1))
  const p2 = await db.payment.findUnique({ where: { id: payment.id } })
  check('order: payment VERIFIED via GATEWAY with UTR from gateway', p2?.status === 'VERIFIED' && p2?.verifiedVia === 'GATEWAY' && Boolean(p2?.utr), `${p2?.status}/${p2?.verifiedVia}/utr=${p2?.utr}`)
  const o2 = await db.order.findUnique({ where: { id: order.id }, select: { status: true } })
  check('order: order auto-CONFIRMED by pull', o2?.status === 'CONFIRMED', String(o2?.status))
  const jobs1 = await db.printJob.findMany({ where: { orderItemId: item.id } })
  check('order: print job auto-queued by pull fan-out', jobs1.length === 1, `jobs=${jobs1.length}`)

  // ---------- 5. throttle ----------
  const stamp1 = (await db.payment.findUnique({ where: { id: payment.id }, select: { gatewayCheckedAt: true } }))?.gatewayCheckedAt
  await sleep(30)
  const recThrottle = await reconcileOrderPaymentFromGateway(payment.id)
  const stamp2 = (await db.payment.findUnique({ where: { id: payment.id }, select: { gatewayCheckedAt: true } }))?.gatewayCheckedAt
  check('order: second pull within 20s throttled', recThrottle.checked === false && stamp1?.getTime() === stamp2?.getTime(), JSON.stringify(recThrottle))

  // ---------- 2. positive pull reconciliation (subscription) ----------
  const recSub = await reconcileSubscriptionPaymentFromGateway(subPay.id)
  check('subscription: pull reconcile advances on RECONCILED', recSub.checked === true && recSub.advanced === true, JSON.stringify(recSub))
  const sp1 = await db.subscriptionPayment.findUnique({ where: { id: subPay.id } })
  check('subscription: payment VERIFIED via GATEWAY', sp1?.status === 'VERIFIED' && sp1?.verifiedVia === 'GATEWAY', `${sp1?.status}/${sp1?.verifiedVia}`)
  const sub1 = await db.subscription.findUnique({ where: { shopId: shop.id } })
  check('subscription: plan AUTO-ACTIVATED by pull', sub1?.status === 'ACTIVE' && Boolean(sub1?.expiresAt), String(sub1?.status))
  const shopAfter = await db.shop.findUnique({ where: { id: shop.id }, select: { isActive: true } })
  check('subscription: shop re-activated by pull', shopAfter?.isActive === true, String(shopAfter?.isActive))

  // ---------- 3. double-extension guard (two concurrent advances) ----------
  const subPay2 = await db.subscriptionPayment.create({ data: { shopId: shop.id, planId: plan.id, amountPaise: plan.pricePaise, utr: null, status: 'PENDING', gatewayRef: `gw-sub2-${randomUUID()}` } })
  const expBefore = (await db.subscription.findUnique({ where: { shopId: shop.id } }))?.expiresAt
  const [a, b] = await Promise.all([
    advanceSubscriptionByGateway(subPay2.id, { gatewayRef: 'gw-race-a', deliveryId: randomUUID() }),
    advanceSubscriptionByGateway(subPay2.id, { gatewayRef: 'gw-race-b', deliveryId: randomUUID() }),
  ])
  const expAfter = (await db.subscription.findUnique({ where: { shopId: shop.id } }))?.expiresAt
  const advancedCount = (a.advanced ? 1 : 0) + (b.advanced ? 1 : 0)
  check('subscription: concurrent advances — exactly ONE wins', advancedCount === 1, `a=${a.advanced}/${a.reason} b=${b.advanced}/${b.reason}`)
  check('subscription: expiry extended exactly once (no double extension)', expAfter && expBefore && Math.round((expAfter.getTime() - expBefore.getTime()) / 86400000) === plan.durationDays, `diff=${expAfter && expBefore ? Math.round((expAfter.getTime() - expBefore.getTime()) / 86400000) : 'n/a'}d (plan ${plan.durationDays}d)`)

  // ---------- 4. double fan-out guard (concurrent order advances) ----------
  const order2 = await db.order.create({ data: { shopId: shop.id, customerSessionId: cs.id, orderNumber: `GWR-${randomBytes(3).toString('hex').toUpperCase()}`, status: 'PENDING_PAYMENT', totalPaise: 100 } })
  const item2 = await db.orderItem.create({ data: { orderId: order2.id, shopId: shop.id, documentId: doc.id, colorMode: 'BW', paperSize: 'A4', duplex: false, copies: 1, pageCount: 1, unitPricePaise: 100, totalPaise: 100 } })
  const payment2 = await db.payment.create({ data: { orderId: order2.id, shopId: shop.id, method: 'UPI', amountPaise: 100, upiVpa: 'e2e@upi', qrPayload: 'upi://gwr2', txnRef: order2.orderNumber, status: 'PENDING', gatewayRef: `gw-pay2-${randomUUID()}` } })
  const [c, d] = await Promise.all([
    advanceOrderPaymentByGateway(payment2.id, { gatewayRef: 'gw-race-c', deliveryId: randomUUID() }),
    advanceOrderPaymentByGateway(payment2.id, { gatewayRef: 'gw-race-d', deliveryId: randomUUID() }),
  ])
  const jobs2 = await db.printJob.findMany({ where: { orderItemId: item2.id } })
  check('order: concurrent advances — exactly ONE claims', (c.advanced ? 1 : 0) + (d.advanced ? 1 : 0) === 1, `c=${c.advanced}/${c.reason} d=${d.advanced}/${d.reason}`)
  check('order: unique constraint holds — exactly one print job', jobs2.length === 1, `jobs=${jobs2.length}`)

  // ---------- 6. REJECTED-but-paid must still be honored ----------
  const order3 = await db.order.create({ data: { shopId: shop.id, customerSessionId: cs.id, orderNumber: `GWR-${randomBytes(3).toString('hex').toUpperCase()}`, status: 'PENDING_PAYMENT', totalPaise: 250 } })
  const item3 = await db.orderItem.create({ data: { orderId: order3.id, shopId: shop.id, documentId: doc.id, colorMode: 'BW', paperSize: 'A4', duplex: false, copies: 1, pageCount: 1, unitPricePaise: 250, totalPaise: 250 } })
  const payment3 = await db.payment.create({ data: { orderId: order3.id, shopId: shop.id, method: 'UPI', amountPaise: 250, upiVpa: 'e2e@upi', qrPayload: 'upi://gwr3', txnRef: order3.orderNumber, status: 'REJECTED', rejectionReason: 'Cancelled by shop (payment not completed)', gatewayRef: 'gw-pay-rejected' } })
  const rec3 = await reconcileOrderPaymentFromGateway(payment3.id)
  check('order: REJECTED-but-paid is honored by pull (money never lost)', rec3.advanced === true, JSON.stringify(rec3))
  const o3 = await db.order.findUnique({ where: { id: order3.id }, select: { status: true } })
  check('order: cancelled-then-paid order auto-CONFIRMED', o3?.status === 'CONFIRMED', String(o3?.status))
  const jobs3 = await db.printJob.findMany({ where: { orderItemId: item3.id } })
  check('order: cancelled-then-paid prints', jobs3.length === 1, `jobs=${jobs3.length}`)

  // ---------- negative pull shapes on subscription (echo JSON, no fields) ----------
  const subPay3 = await db.subscriptionPayment.create({ data: { shopId: shop.id, planId: plan.id, amountPaise: plan.pricePaise, utr: null, status: 'PENDING', gatewayRef: `gw-sub3-${randomUUID()}` } })
  const { createServer: _cs } = await import('node:http')
  const echoServer = await new Promise<Server>((resolve) => {
    const s = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ slideshow: { title: 'not a payment' } })) })
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  const echoPort = (echoServer.address() as { port: number }).port
  await db.platformSetting.update({ where: { key: 'youpi_api_url' }, data: { value: `http://127.0.0.1:${echoPort}` } })
  const recEcho = await reconcileSubscriptionPaymentFromGateway(subPay3.id)
  check('subscription: non-credit gateway response never advances', recEcho.checked === true && recEcho.advanced === false, JSON.stringify(recEcho))
  const sp3 = await db.subscriptionPayment.findUnique({ where: { id: subPay3.id }, select: { status: true } })
  check('subscription: stays PENDING after non-credit response', sp3?.status === 'PENDING', String(sp3?.status))
  echoServer.close()

  console.log(`\nSUMMARY: ${pass} passed, ${fail} failed`)

  // ---------- cleanup ----------
  console.log('\ncleanup…')
  const shopId = shop.id
  const paymentIds = (await db.payment.findMany({ where: { shopId } })).map((p) => p.id)
  const subPayIds = (await db.subscriptionPayment.findMany({ where: { shopId } })).map((r) => r.id)
  const step = async (name: string, fn: () => Promise<unknown>) => { try { await fn() } catch (e) { console.log(`  warn: ${name}: ${String((e as Error).message).slice(0, 100)}`) } }
  await step('gatewayEvents', () => db.gatewayEvent.deleteMany({ where: { OR: [{ targetId: { in: paymentIds } }, { targetId: { in: subPayIds } }] } }))
  await step('subPayments', () => db.subscriptionPayment.deleteMany({ where: { shopId } }))
  await step('subscription', () => db.subscription.deleteMany({ where: { shopId } }))
  await step('printEvents', () => db.printEvent.deleteMany({ where: { shopId } }))
  await step('printJobs', () => db.printJob.deleteMany({ where: { shopId } }))
  await step('routingRules', () => db.routingRule.deleteMany({ where: { shopId } }))
  await step('printers', () => db.printer.deleteMany({ where: { shopId } }))
  await step('orderItems', () => db.orderItem.deleteMany({ where: { shopId } }))
  await step('paymentVerifications', () => db.paymentVerification.deleteMany({ where: { paymentId: { in: paymentIds } } }))
  await step('payments', () => db.payment.deleteMany({ where: { shopId } }))
  await step('orders', () => db.order.deleteMany({ where: { shopId } }))
  const docs = await db.document.findMany({ where: { shopId }, select: { storedPath: true } })
  await step('documents', () => db.document.deleteMany({ where: { shopId } }))
  await step('storedObjects', () => db.storedObject.deleteMany({ where: { key: { in: docs.map((d) => d.storedPath) } } }))
  await step('customerSessions', () => db.customerSession.deleteMany({ where: { shopId } }))
  await step('notifications', () => db.notification.deleteMany({ where: { shopId } }))
  await step('auditLogs', () => db.auditLog.deleteMany({ where: { OR: [{ entity: 'Shop', entityId: shopId }, { action: { in: ['PAYMENT_VERIFIED_GATEWAY', 'PAYMENT_PRINT_FANOUT_FAILED', 'SUBSCRIPTION_VERIFIED_GATEWAY'] }, entityId: { in: [...paymentIds, ...subPayIds, order.id, order2.id, order3.id] } }] } }))
  await step('shop', () => db.shop.delete({ where: { id: shopId } }))
  for (const [k, v] of created) await db.platformSetting.deleteMany({ where: { key: k, value: v } })
  await db.platformSetting.deleteMany({ where: { key: 'youpi_api_url' } })
  const left = await db.shop.count({ where: { slug: { startsWith: 'gwr-' } } })
  console.log(`cleanup done: gwr shops left=${left}`)
  server.close()
}

main()
  .catch((e) => { console.error('GWR ERROR:', e); process.exitCode = 1 })
  .finally(async () => {
    await db.$disconnect()
    // Pending fire-and-forget side effects (WhatsApp alerts) must not keep
    // the process alive past the summary.
    setTimeout(() => process.exit(process.exitCode || 0), 250).unref()
  })
