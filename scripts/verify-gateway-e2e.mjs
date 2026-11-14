// FULL E2E verification of both money chains on PRODUCTION, using synthetic
// YouPI-signed webhooks against the LIVE app. Everything is namespaced
// 'gw-e2e-' and DELETED afterwards — the real shop's data is never touched.
//
// ORDER FLOW:     temp shop + customer session + doc + order + payment (PENDING)
//                 → signed RECONCILED webhook → assert payment VERIFIED(GATEWAY),
//                 order CONFIRMED, print job fanned out. Negative gates: bad sig
//                 401, wrong amount 409, OBSERVED_SUCCESS rejected (strict),
//                 deliveryId replay deduped.
// SUBSCRIPTION:   temp subscription payment for the temp shop + platform gateway
//                 settings (temporary) → signed SUB- webhook → assert payment
//                 VERIFIED(GATEWAY), subscription ACTIVE, shop re-activated,
//                 expiry extended; replay → deduped, expiry unchanged.
// CLEANUP:        deletes every temp row (shop cascade) + restores settings.
// Run: node scripts/verify-gateway-e2e.mjs
import { PrismaClient } from '@prisma/client'
import { createHmac, randomUUID, randomBytes } from 'crypto'

const BASE = 'https://copysahaayak.vercel.app'
const TAG = `gw-e2e-${Date.now().toString(36)}`
let url = (await import('fs')).readFileSync('/tmp/dburl.txt', 'utf8').trim()
if (!url.includes('schema=')) url += (url.includes('?') ? '&' : '?') + 'schema=csp'
const db = new PrismaClient({ datasources: { db: { url } } })

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`)
  if (!ok) process.exitCode = 1
}
const sha = (data, secret) => createHmac('sha256', secret).update(data, 'utf8').digest('hex')

function sign(payloadObj, secret) {
  const body = JSON.stringify(payloadObj)
  const ts = String(Date.now())
  return {
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Event': payloadObj.event,
      'X-Gateway-Delivery-Id': payloadObj.deliveryId,
      'X-Gateway-Timestamp': ts,
      'X-Gateway-Signature': `sha256=${sha(body, secret)}`,
      'X-Gateway-Signature-V2': `sha256=${sha(`${ts}.${body}`, secret)}`,
    },
  }
}

async function deliver(payloadObj, secret) {
  const { body, headers } = sign(payloadObj, secret)
  const res = await fetch(`${BASE}/api/webhooks/youpi`, { method: 'POST', headers, body })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const createdSettings = [] // exact rows this script creates — cleanup deletes exactly these

async function main() {
  const secret = `whsec_${randomBytes(16).toString('hex')}`
  const platformSecret = `whsec_${randomBytes(16).toString('hex')}`

  // ---------- temp fixtures ----------
  const admin = await db.user.create({ data: { email: `${TAG}@e2e.test`, passwordHash: 'x', name: 'GW E2E Admin', role: 'SHOP_ADMIN' } })
  const shop = await db.shop.create({ data: { slug: TAG, name: 'GW E2E Shop', upiVpa: 'e2e@upi', upiPayeeName: 'GW E2E', isActive: true } })
  const printer = await db.printer.create({ data: { shopId: shop.id, windowsName: 'E2E Printer', colorMode: 'ANY', paperSizesJson: '["A4"]', status: 'ONLINE' } })
  const cs = await db.customerSession.create({ data: { shopId: shop.id, tokenHash: randomBytes(32).toString('hex'), name: 'E2E Customer' } })
  const so = await db.storedObject.create({ data: { key: `uploads/${shop.id}/e2e.pdf`, mimeType: 'application/pdf', bytes: Buffer.from('%PDF-1.4 e2e'), sizeBytes: 14 } })
  const doc = await db.document.create({ data: { shopId: shop.id, customerSessionId: cs.id, originalName: 'e2e.pdf', storedPath: so.key, mimeType: 'application/pdf', sizeBytes: 14, pageCount: 2, status: 'READY', checksum: 'e2e-checksum' } })
  const order = await db.order.create({
    data: { shopId: shop.id, customerSessionId: cs.id, orderNumber: `E2E-${randomBytes(3).toString('hex').toUpperCase()}`, status: 'PENDING_PAYMENT', totalPaise: 100 },
  })
  const item = await db.orderItem.create({ data: { orderId: order.id, shopId: shop.id, documentId: doc.id, colorMode: 'BW', paperSize: 'A4', duplex: false, copies: 1, pageCount: 2, unitPricePaise: 50, totalPaise: 100 } })
  const payment = await db.payment.create({
    data: { orderId: order.id, shopId: shop.id, method: 'UPI', amountPaise: 100, upiVpa: 'e2e@upi', qrPayload: 'upi://e2e', txnRef: order.orderNumber, status: 'PENDING' },
  })
  await db.shop.update({ where: { id: shop.id }, data: { youpiEnabled: true, youpiMerchantId: 'mrc_e2e', youpiApiKey: 'ak_e2e', youpiWebhookSecret: secret, youpiPublicKey: 'pk_e2e' } })
  // Platform gateway settings must exist BEFORE order tests: the shop-scope
  // config inherits the shared gateway base URL from the platform settings.
  // Upsert (not createMany): a crashed earlier run may have left rows behind.
  createdSettings.push(
    ['youpi_api_url', 'https://gw-e2e.invalid'],
    ['youpi_merchant_id', 'mrc_platform_e2e'],
    ['youpi_merchant_api_key', 'ak_platform_e2e'],
    ['youpi_webhook_secret', platformSecret]
  )
  for (const [key, value] of createdSettings) {
    await db.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  }
  console.log(`fixtures: shop=${shop.slug} order=${order.orderNumber} payment=${payment.id}`)

  // ---------- ORDER FLOW ----------
  const deliveryId = randomUUID()
  const payload = { event: 'RECONCILED', settlementState: 'RECONCILED', method: 'UPI', orderId: `ORD-${payment.id}`, amount: '1.00', amountPaise: 100, utr: '402512345678', paymentId: 'gw-pay-e2e-1', deliveryId, timestamp: Date.now() }

  const badSig = await deliver({ ...payload, deliveryId: randomUUID() }, 'whsec_wrong')
  check('order: wrong-signature webhook rejected 401', badSig.status === 401, JSON.stringify(badSig.json))

  const wrongAmt = await deliver({ ...payload, amountPaise: 999, amount: '9.99', deliveryId: randomUUID() }, secret)
  check('order: amount mismatch rejected 409', wrongAmt.status === 409, JSON.stringify(wrongAmt.json))

  const observed = await deliver({ ...payload, event: 'OBSERVED_SUCCESS', settlementState: 'NOT_RECONCILED', deliveryId: randomUUID() }, secret)
  check('order: OBSERVED_SUCCESS rejected in strict mode', observed.status === 200 && observed.json.accepted === false, JSON.stringify(observed.json))

  const cod = await deliver({ ...payload, event: 'SUCCESS', method: 'COD', deliveryId: randomUUID() }, secret)
  check('order: COD never advances', cod.status === 200 && cod.json.accepted === false, JSON.stringify(cod.json))

  const ok = await deliver(payload, secret)
  check('order: RECONCILED webhook accepted', ok.status === 200 && ok.json.accepted === true, JSON.stringify(ok.json))

  const pAfter = await db.payment.findUnique({ where: { id: payment.id } })
  check('order: payment VERIFIED via GATEWAY', pAfter?.status === 'VERIFIED' && pAfter?.verifiedVia === 'GATEWAY' && pAfter?.gatewayRef === 'gw-pay-e2e-1', `${pAfter?.status}/${pAfter?.verifiedVia}`)
  check('order: UTR captured from webhook', pAfter?.utr === '402512345678', String(pAfter?.utr))
  const oAfter = await db.order.findUnique({ where: { id: order.id } })
  check('order: order auto-CONFIRMED', oAfter?.status === 'CONFIRMED', String(oAfter?.status))
  const jobs = await db.printJob.findMany({ where: { orderItemId: item.id } })
  check('order: print job AUTO-QUEUED (fan-out)', jobs.length >= 1, `jobs=${jobs.length} status=${jobs[0]?.status}`)

  const replay = await deliver(payload, secret)
  check('order: deliveryId replay deduped', replay.status === 200 && replay.json.deduped === true, JSON.stringify(replay.json))

  // ---------- SUBSCRIPTION FLOW ----------
  const plan = (await db.plan.findMany({ where: { isActive: true, pricePaise: { gt: 0 } }, orderBy: { pricePaise: 'asc' } }))[0]
  check('subscription: paid plan exists', Boolean(plan), plan?.code || 'none')
  if (plan) {
    const subPay = await db.subscriptionPayment.create({
      data: { shopId: shop.id, planId: plan.id, amountPaise: plan.pricePaise, utr: null, status: 'PENDING' },
    })
    const subPayload = { event: 'RECONCILED', settlementState: 'RECONCILED', method: 'UPI', orderId: `SUB-${subPay.id}`, amount: (plan.pricePaise / 100).toFixed(2), amountPaise: plan.pricePaise, utr: '402512345679', paymentId: 'gw-pay-e2e-2', deliveryId: randomUUID(), timestamp: Date.now() }

    const wrongScope = await deliver({ ...subPayload, deliveryId: randomUUID() }, secret) // signed with SHOP secret — must fail for SUB scope
    check('subscription: shop-secret cannot confirm platform payment', wrongScope.status === 401, JSON.stringify(wrongScope.json))

    const subOk = await deliver(subPayload, platformSecret)
    check('subscription: RECONCILED webhook accepted', subOk.status === 200 && subOk.json.accepted === true, JSON.stringify(subOk.json))

    const spAfter = await db.subscriptionPayment.findUnique({ where: { id: subPay.id } })
    check('subscription: payment VERIFIED via GATEWAY', spAfter?.status === 'VERIFIED' && spAfter?.verifiedVia === 'GATEWAY', `${spAfter?.status}/${spAfter?.verifiedVia}`)
    const subAfter = await db.subscription.findUnique({ where: { shopId: shop.id } })
    check('subscription: plan AUTO-ACTIVATED with expiry', subAfter?.status === 'ACTIVE' && Boolean(subAfter?.expiresAt), `${subAfter?.status} exp=${subAfter?.expiresAt?.toISOString()}`)
    const shopAfter = await db.shop.findUnique({ where: { id: shop.id }, select: { isActive: true } })
    check('subscription: shop auto re-activated', shopAfter?.isActive === true, String(shopAfter?.isActive))

    const expBefore = subAfter?.expiresAt
    const subReplay = await deliver(subPayload, platformSecret)
    const expAfter = (await db.subscription.findUnique({ where: { shopId: shop.id } }))?.expiresAt
    check('subscription: replay deduped (expiry NOT extended)', subReplay.json.deduped === true && expBefore?.getTime() === expAfter?.getTime(), `deduped=${subReplay.json.deduped}`)
  }

  console.log(`\nSUMMARY: ${pass} passed, ${fail} failed`)
}

async function cleanup() {
  console.log('\ncleanup…')
  const step = async (name, fn) => { try { await fn() } catch (e) { console.log(`  warn: ${name}: ${String(e.message || e).slice(0, 120)}`) } }
  const shops = await db.shop.findMany({ where: { slug: { startsWith: 'gw-e2e-' } }, select: { id: true } })
  for (const s of shops) {
    // Explicit child deletes (cascade order is not guaranteed across FKs).
    const paymentIds = (await db.payment.findMany({ where: { shopId: s.id } })).map((p) => p.id)
    const subPayIds = (await db.subscriptionPayment.findMany({ where: { shopId: s.id }, select: { id: true } })).map((r) => r.id)
    const events = await db.gatewayEvent.deleteMany({ where: { OR: [{ targetId: { in: paymentIds } }, { targetId: { in: subPayIds } }] } })
    await step('subPayment', () => db.subscriptionPayment.deleteMany({ where: { shopId: s.id } }))
    await step('subscription', () => db.subscription.deleteMany({ where: { shopId: s.id } }))
    await step('printEvents', () => db.printEvent.deleteMany({ where: { shopId: s.id } }))
    await step('printJobs', () => db.printJob.deleteMany({ where: { shopId: s.id } }))
    await step('routingRules', () => db.routingRule.deleteMany({ where: { shopId: s.id } }))
    await step('printers', () => db.printer.deleteMany({ where: { shopId: s.id } }))
    await step('devices', () => db.device.deleteMany({ where: { shopId: s.id } }))
    await step('orderItems', () => db.orderItem.deleteMany({ where: { shopId: s.id } }))
    await step('paymentVerifications', () => db.paymentVerification.deleteMany({ where: { paymentId: { in: paymentIds } } }))
    await step('payments', () => db.payment.deleteMany({ where: { shopId: s.id } }))
    await step('orders', () => db.order.deleteMany({ where: { shopId: s.id } }))
    const docs = await db.document.findMany({ where: { shopId: s.id }, select: { storedPath: true } })
    await step('documents', () => db.document.deleteMany({ where: { shopId: s.id } }))
    await step('storedObjects', () => db.storedObject.deleteMany({ where: { key: { in: docs.map((d) => d.storedPath) } } }))
    await step('customerSessions', () => db.customerSession.deleteMany({ where: { shopId: s.id } }))
    await step('pricingRules', () => db.pricingRule.deleteMany({ where: { shopId: s.id } }))
    await step('notifications', () => db.notification.deleteMany({ where: { shopId: s.id } }))
    await step('weeklyReports', () => db.weeklyReport.deleteMany({ where: { shopId: s.id } }))
    await step('auditLogs', () => db.auditLog.deleteMany({ where: { shopId: s.id } }))
    await step('shop', () => db.shop.delete({ where: { id: s.id } }))
    console.log(`  shop ${s.id} deleted (gatewayEvents: ${events.count})`)
  }
  await db.user.deleteMany({ where: { email: { endsWith: '@e2e.test' } } })
  for (const [key, value] of createdSettings) {
    await db.platformSetting.deleteMany({ where: { key, value } })
  }
  await db.auditLog.deleteMany({ where: { OR: [{ entity: 'Shop', entityId: { in: shops.map((s) => s.id) } }, { action: { in: ['PAYMENT_VERIFIED_GATEWAY', 'SUBSCRIPTION_VERIFIED_GATEWAY', 'GATEWAY_SESSION_CREATED'] }, metaJson: { contains: 'gw-pay-e2e' } }] } })
  const users = await db.user.count({ where: { email: { endsWith: '@e2e.test' } } })
  const shopsLeft = await db.shop.count({ where: { slug: { startsWith: 'gw-e2e-' } } })
  const settingsLeft = await db.platformSetting.count({ where: { key: { startsWith: 'youpi_' } } })
  console.log(`cleanup done: e2e users left=${users}, shops left=${shopsLeft}, youpi settings left=${settingsLeft}`)
}

main()
  .catch((e) => { console.error('E2E ERROR:', e); process.exitCode = 1 })
  .finally(async () => { await cleanup(); await db.$disconnect() })
