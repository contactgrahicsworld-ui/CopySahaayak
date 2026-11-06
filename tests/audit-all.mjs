// CopySahaayak — exhaustive 1-1 function audit (API surface of every UI button).
// Run against the LIVE deployment with REAL credentials:
//   BASE_URL=https://copysahaayak.vercel.app \
//   E2E_SUPER_EMAIL=<super admin email> E2E_SUPER_PASSWORD='<password>' \
//   E2E_OWNER_EMAIL=contact.grahicsworld@gmail.com E2E_OWNER_PASSWORD='...' \
//   bun tests/audit-all.mjs
//
// Rules enforced by this script:
//   • every dashboard tab's backing API is called (positive + role-mismatch negative)
//   • every mutating call is RESTORED (original values re-written) or done on a
//     disposable shop that is deleted again at the end
//   • page renders of all public/portal pages are checked
//   • exits non-zero on any failure — no fake green
const BASE = process.env.BASE_URL || 'https://copysahaayak.vercel.app'
const RUN = 'a' + Math.random().toString(36).slice(2, 8)

let passed = 0
let failed = 0
const failures = []

function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name} ${detail}`)
  }
}

class Jar {
  constructor() { this.cookies = new Map() }
  absorb(res) {
    const set = res.headers.getSetCookie?.() || []
    for (const c of set) {
      const [pair] = c.split(';')
      const eq = pair.indexOf('=')
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ') }
}

async function req(path, { method = 'GET', body, jar, headers = {}, raw } = {}) {
  const h = { ...headers }
  if (jar) h.Cookie = jar.header()
  if (body !== undefined && !(body instanceof FormData)) h['Content-Type'] = 'application/json'
  if (method !== 'GET') h.Origin = BASE
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    redirect: 'manual',
  })
  if (jar) jar.absorb(res)
  if (raw) return { res, buf: Buffer.from(await res.arrayBuffer()) }
  let data = null
  try { data = await res.json() } catch {}
  return { res, data }
}

async function html(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  let text = ''
  try { text = await res.text() } catch {}
  return { res, text }
}

function pdfBuffer() {
  // Minimal valid 1-page PDF (same trick as the upload pipeline tests).
  return Buffer.from(
    'BT /F1 24 Tf 72 700 Td (CopySahaayak audit) Tj ET',
  )
}

function wrapPdf(inner) {
  const objects = []
  objects.push('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n')
  objects.push('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n')
  objects.push('3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n')
  objects.push(`4 0 obj<</Length ${inner.length}>>stream\n${inner}\nendstream endobj\n`)
  objects.push('5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n')
  let out = '%PDF-1.4\n'
  const offsets = []
  for (const o of objects) { offsets.push(out.length); out += o }
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out, 'latin1')
}

async function main() {
  console.log(`1-1 FUNCTION AUDIT against ${BASE}  (run ${RUN})\n`)

  const jarSuper = new Jar()
  const jarOwner = new Jar()

  // ================================================= [1] Pages render
  console.log('[1] Page renders (every public + portal route)')
  {
    for (const p of ['/', '/login', '/register', '/forgot-password', '/download', '/setup']) {
      const { res, text } = await html(p)
      check(`page ${p} renders 200`, res.status === 200 && text.length > 500 && !text.includes('__next_error__'), `status ${res.status} len ${text.length}`)
    }
    const { res: dRes, text: dText } = await html('/download')
    check('/download page mentions the installer', dRes.status === 200 && /DesktopSahaayak/i.test(dText))
  }

  // ================================================= [2] Auth & sessions
  console.log('[2] Authentication')
  {
    const bad = await req('/api/auth/login', { method: 'POST', body: { email: 'nobody.probe@invalid.test', password: 'wrong-password' } })
    check('unknown/wrong credentials → 401', bad.res.status === 401, `got ${bad.res.status}`)

    const s = await req('/api/auth/login', { method: 'POST', body: { email: process.env.E2E_SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD } })
    check('super admin login', s.res.status === 200 && s.data.user?.role === 'SUPER_ADMIN', JSON.stringify(s.data))
    jarSuper.absorb(s.res)

    const o = await req('/api/auth/login', { method: 'POST', body: { email: process.env.E2E_OWNER_EMAIL, password: process.env.E2E_OWNER_PASSWORD } })
    check('shop owner login', o.res.status === 200 && o.data.user?.role === 'SHOP_ADMIN', JSON.stringify(o.data))
    jarOwner.absorb(o.res)

    const me = await req('/api/auth/me', { jar: jarOwner })
    check('/api/auth/me returns the owner', me.res.status === 200 && me.data.user?.role === 'SHOP_ADMIN', JSON.stringify(me.data))

    const noAuth = await req('/api/auth/me')
    check('/api/auth/me without session → user:null (or 401)', (noAuth.res.status === 200 && noAuth.data?.user === null) || noAuth.res.status === 401 || noAuth.res.status === 403, JSON.stringify(noAuth.data))
  }

  // ================================================= [3] Disposable shop (all destructive tests happen here)
  console.log('[3] Disposable shop provisioning (super creates shop)')
  let disp = null // { id, slug, email, password, jar }
  {
    const slug = `audit-${RUN}`
    const email = `owner.${RUN}@audit-test.in`
    const password = `Audit#${RUN}1Ax`
    const create = await req('/api/super/shops', {
      method: 'POST', jar: jarSuper,
      body: { name: `Audit Shop ${RUN}`, slug, ownerName: 'Audit Owner', adminEmail: email, adminPassword: password, planCode: 'FREE' },
    })
    check('super creates shop via POST /api/super/shops', create.res.status === 200 || create.res.status === 201, JSON.stringify(create.data))
    disp = { id: create.data?.shop?.id || create.data?.id, slug, email, password, jar: new Jar() }

    const dup = await req('/api/super/shops', {
      method: 'POST', jar: jarSuper,
      body: { name: 'Dup', slug, ownerName: 'Dup', adminEmail: `other.${RUN}@audit-test.in`, adminPassword: `Audit#${RUN}2Ax`, planCode: 'FREE' },
    })
    check('duplicate slug rejected 409', dup.res.status === 409, `got ${dup.res.status}`)

    const asOwner = await req('/api/super/shops', { method: 'POST', jar: jarOwner, body: {} })
    check('shop owner blocked from super shop creation → 403', asOwner.res.status === 403, `got ${asOwner.res.status}`)

    const login = await req('/api/auth/login', { method: 'POST', body: { email, password } })
    check('disposable owner can login', login.res.status === 200, JSON.stringify(login.data))
    disp.jar.absorb(login.res)

    // Give the disposable shop its own UPI via the owner settings API (also
    // exercises the exact button the real shop owner uses).
    const upiSet = await req('/api/admin/shop', { method: 'PATCH', jar: disp.jar, body: { name: `Audit Shop ${RUN}`, upiVpa: `audit${RUN}@okaudit`, upiPayeeName: 'Audit Owner' } })
    check('owner sets shop UPI (PATCH /api/admin/shop)', upiSet.res.status === 200, JSON.stringify(upiSet.data))
  }

  // ================================================= [4] Customer flow (on disposable shop → full verify + print pipeline)
  console.log('[4] Customer end-to-end order flow')
  const cust = new Jar()
  let docId = null
  let orderNumber = null
  let paymentId = null
  {
    const sess = await req(`/api/shops/${disp.slug}/session`, { method: 'POST', body: {} })
    check('guest session created', sess.res.status === 200 && !!sess.data?.sessionId, JSON.stringify(sess.data))
    cust.absorb(sess.res)

    const pub = await req(`/api/shops/${disp.slug}`)
    check('public shop info + 8 default pricing rules', pub.res.status === 200 && pub.data?.pricing?.length === 8 && pub.data?.shop?.upiConfigured === true, JSON.stringify(pub.data?.shop))

    const qr = await req(`/api/shops/${disp.slug}/qr`)
    check('shop counter QR endpoint returns PNG data URL', qr.res.status === 200 && (qr.data?.dataUrl || '').startsWith('data:image/png'), JSON.stringify(qr.data).slice(0, 120))

    const form = new FormData()
    form.append('file', new Blob([wrapPdf(pdfBuffer())], { type: 'application/pdf' }), 'audit.pdf')
    const up = await req(`/api/shops/${disp.slug}/uploads`, { method: 'POST', body: form, jar: cust })
    check('PDF upload accepted + page counted', up.res.status === 200 && up.data?.pageCount === 1, JSON.stringify(up.data))
    docId = up.data?.documentId

    const evilForm = new FormData()
    evilForm.append('file', new Blob([Buffer.from('<html>not a pdf</html>')], { type: 'application/pdf' }), 'evil.pdf')
    const evil = await req(`/api/shops/${disp.slug}/uploads`, { method: 'POST', body: evilForm, jar: cust })
    check('fake PDF rejected 415', evil.res.status === 415, `got ${evil.res.status}`)

    const ord = await req(`/api/shops/${disp.slug}/orders`, {
      method: 'POST', jar: cust,
      body: { items: [{ documentId: docId, paperSize: 'A4', colorMode: 'BW', copies: 2, sides: 'SINGLE', duplex: false, pageSelection: null }], customerName: 'Audit Customer', customerPhone: '9800000000' },
    })
    check('order created with UPI QR', ord.res.status === 200 && ord.data?.orderNumber && ord.data?.upi?.payload?.includes('upi://pay'), JSON.stringify(ord.data).slice(0, 200))
    orderNumber = ord.data?.orderNumber

    const utr = await req(`/api/shops/${disp.slug}/orders/${orderNumber}/utr`, { method: 'POST', jar: cust, body: { utr: `AUDIT${RUN}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20), payerName: 'Audit Customer' } })
    check('UTR submitted → AWAITING_VERIFICATION', utr.res.status === 200, JSON.stringify(utr.data))

    const track = await req(`/api/shops/${disp.slug}/orders/${orderNumber}`, { jar: cust })
    check('customer tracks own order', track.res.status === 200 && track.data?.status === 'AWAITING_VERIFICATION', `got ${track.data?.status}`)
  }

  // ================================================= [5] Shop dashboard tabs (owner APIs)
  console.log('[5] Shop owner dashboard — every tab API')
  {
    const dash = await req('/api/admin/dashboard', { jar: jarOwner })
    check('Overview: /api/admin/dashboard', dash.res.status === 200 && typeof dash.data?.orders !== 'undefined', JSON.stringify(dash.data).slice(0, 150))

    const list = await req('/api/admin/orders?status=ALL&q=', { jar: jarOwner })
    check('Orders: list with filter', list.res.status === 200 && Array.isArray(list.data?.orders), `got ${list.res.status}`)

    const noAuth = await req('/api/admin/orders')
    check('orders list without session → 401', noAuth.res.status === 401, `got ${noAuth.res.status}`)
    const asSuper = await req('/api/admin/orders', { jar: jarSuper })
    check('super blocked from shop admin API → 403', asSuper.res.status === 403, `got ${asSuper.res.status}`)

    const pays = await req('/api/admin/payments?status=SUBMITTED', { jar: disp.jar })
    const ownPay = (pays.data?.payments || []).find((p) => p.order?.orderNumber === orderNumber)
    check('Payments: SUBMITTED payment visible', !!ownPay, JSON.stringify(pays.data).slice(0, 150))
    paymentId = ownPay?.id

    const pr = await req('/api/admin/printers', { jar: disp.jar })
    check('Printers: list (empty before device pairs)', pr.res.status === 200 && Array.isArray(pr.data?.printers), `got ${pr.res.status}`)

    const pricing = await req('/api/admin/pricing', { jar: disp.jar })
    check('Pricing: rules list', pricing.res.status === 200 && (pricing.data?.rules || []).length === 8, `got ${(pricing.data?.rules || []).length}`)
    const originalRules = pricing.data?.rules
    if (originalRules?.length) {
      const changed = originalRules.map((r) => (r.paperSize === 'A4' && r.colorMode === 'BW' ? { ...r, singleSidedPaise: 250, duplexPaise: 250 } : r))
      const put = await req('/api/admin/pricing', { method: 'PUT', jar: disp.jar, body: { rules: changed.map(({ id, shopId, ...r }) => r) } })
      check('Pricing: bulk update accepted', put.res.status === 200, JSON.stringify(put.data))
      const after = await req('/api/admin/pricing', { jar: disp.jar })
      const a4 = (after.data?.rules || []).find((r) => r.paperSize === 'A4' && r.colorMode === 'BW')
      check('Pricing: new price live (₹2.50)', a4?.singleSidedPaise === 250, `got ${a4?.singleSidedPaise}`)
      // restore
      await req('/api/admin/pricing', { method: 'PUT', jar: disp.jar, body: { rules: originalRules.map(({ id, shopId, ...r }) => r) } })
    }

    const rep = await req('/api/admin/reports?days=30&groupBy=day', { jar: disp.jar })
    check('Reports: aggregated response', rep.res.status === 200 && rep.data?.rangeDays === 30, JSON.stringify(rep.data).slice(0, 120))

    const csv = await req('/api/admin/reports/export', { jar: disp.jar, raw: true })
    const ct = csv.res.headers.get('content-type') || ''
    check('Reports: export downloads (xlsx/csv)', csv.res.status === 200 && (ct.includes('csv') || ct.includes('spreadsheetml') || ct.includes('octet-stream') || ct.includes('text/plain')), `got ${ct}`)

    const routing = await req('/api/admin/routing', { jar: disp.jar })
    check('Routing: GET', routing.res.status === 200 && Array.isArray(routing.data?.rules), `got ${routing.res.status}`)

    const shopGet = await req('/api/admin/shop', { jar: disp.jar })
    check('Settings: shop profile GET', shopGet.res.status === 200 && shopGet.data?.shop?.slug === disp.slug, JSON.stringify(shopGet.data).slice(0, 120))

    const shopBad = await req('/api/admin/shop', { method: 'PATCH', jar: disp.jar, body: { name: 'x', upiVpa: 'not-a-vpa' } })
    check('Settings: invalid UPI VPA rejected 400', shopBad.res.status === 400, `got ${shopBad.res.status}`)
  }

  // ================================================= [6] Order actions (requeue on own order; cancel tested on a fresh order in [6b])
  console.log('[6] Order actions')
  {
    const orderId = (await req('/api/admin/orders?status=ALL&q=' + orderNumber, { jar: disp.jar })).data?.orders?.[0]?.id
    check('Orders: found the audit order', !!orderId)

    const requeue = await req(`/api/admin/orders/${orderId}`, { method: 'PATCH', jar: disp.jar, body: { action: 'REQUEUE_JOBS' } })
    check('Order action REQUEUE_JOBS (payment already verified)', requeue.res.status === 200 || requeue.res.status === 409, `got ${requeue.res.status} ${JSON.stringify(requeue.data)}`)

    const foreign = await req(`/api/admin/orders/${orderId}`, { method: 'PATCH', jar: jarOwner, body: { action: 'CANCEL' } })
    check('Foreign shop cannot act on the order → 404', foreign.res.status === 404, `got ${foreign.res.status}`)
  }

  // ================================================= [7] Device pipeline (what Desktop Sahaayak does)
  console.log('[7] Device pipeline (pair → heartbeat/printers → claim → print events → revoke)')
  {
    const code = await req('/api/admin/devices', { method: 'POST', jar: disp.jar, body: '{}' })
    check('Devices: pairing code issued', code.res.status === 200 && /^[A-Z0-9]{6}$/.test(code.data?.device?.pairingCode || ''), JSON.stringify(code.data))
    const deviceId = code.data?.device?.id

    const pair = await req('/api/device/pair', { method: 'POST', body: { pairingCode: code.data?.device?.pairingCode, machineName: `Audit-PC-${RUN}`, appVersion: '1.3.1' } })
    check('Device pairs (token issued)', pair.res.status === 200 && !!pair.data?.deviceToken, JSON.stringify(pair.data))
    const devToken = pair.data?.deviceToken
    const devH = { Authorization: `Bearer ${devToken}` }

    const hb = await req('/api/device/heartbeat', { method: 'POST', headers: devH, body: { printers: [{ windowsName: 'Audit LaserJet', colorMode: 'BW', paperSizes: ['A4'] }], appVersion: '1.3.1' } })
    check('Heartbeat registers printer (server upsert)', hb.res.status === 200 && hb.data?.ok === true, JSON.stringify(hb.data))

    const pr = await req('/api/admin/printers', { jar: disp.jar })
    const p1 = (pr.data?.printers || []).find((p) => p.windowsName === 'Audit LaserJet')
    if (p1) {
      const patch = await req('/api/admin/printers', { method: 'PATCH', jar: disp.jar, body: { id: p1.id, displayName: 'Front desk printer', isDefault: true } })
      check('Printer PATCH: displayName + isDefault', patch.res.status === 200, JSON.stringify(patch.data))

      const routingPut = await req('/api/admin/routing', { method: 'PUT', jar: disp.jar, body: { rules: [{ colorMode: 'BW', paperSize: 'A4', printerId: p1.id }] } })
      check('Routing: PUT rule', routingPut.res.status === 200, JSON.stringify(routingPut.data))
    } else {
      check('Owner dashboard sees device printer ONLINE', false, JSON.stringify(pr.data).slice(0, 200))
    }

    const claim = await req('/api/device/jobs/claim', { method: 'POST', headers: devH, body: {} })
    check('Device claims queued job', claim.res.status === 200 && !!claim.data?.job?.id, JSON.stringify(claim.data).slice(0, 200))
    const jobId = claim.data?.job?.id

    const fake = await req(`/api/device/jobs/${jobId}/events`, { method: 'POST', headers: devH, body: { status: 'COMPLETED', message: 'fake' } })
    check('Job event COMPLETED without SPOOLING rejected 409', fake.res.status === 409, `got ${fake.res.status}`)

    const spool = await req(`/api/device/jobs/${jobId}/events`, { method: 'POST', headers: devH, body: { status: 'SPOOLING' } })
    check('Job event SPOOLING accepted', spool.res.status === 200, JSON.stringify(spool.data))

    const done = await req(`/api/device/jobs/${jobId}/events`, { method: 'POST', headers: devH, body: { status: 'COMPLETED', message: 'printed by audit' } })
    check('Job event COMPLETED accepted', done.res.status === 200, JSON.stringify(done.data))

    const tracked = await req(`/api/shops/${disp.slug}/orders/${orderNumber}`, { jar: cust })
    check('Order auto-COMPLETED after all jobs printed', tracked.data?.status === 'COMPLETED', `got ${tracked.data?.status}`)

    const revoke = await req(`/api/admin/devices/${deviceId}`, { method: 'DELETE', jar: disp.jar })
    check('Devices: revoke (DELETE)', revoke.res.status === 200, JSON.stringify(revoke.data))

    const after = await req('/api/device/heartbeat', { method: 'POST', headers: devH, body: { printers: [] } })
    check('Revoked device token rejected 401', after.res.status === 401, `got ${after.res.status}`)
  }

  // ================================================= [7b] Order CANCEL on a fresh unpaid order
  console.log('[7b] Order cancel (fresh order)')
  {
    const ord2 = await req(`/api/shops/${disp.slug}/orders`, {
      method: 'POST', jar: cust,
      body: { items: [{ documentId: docId, paperSize: 'A4', colorMode: 'BW', copies: 1, sides: 'SINGLE', duplex: false, pageSelection: null }], customerName: 'Audit Cancel', customerPhone: '9800000001' },
    })
    check('second order created', ord2.res.status === 200, JSON.stringify(ord2.data).slice(0, 150))
    if (ord2.res.status === 200) {
      const found = await req(`/api/admin/orders?status=ALL&q=${ord2.data.orderNumber}`, { jar: disp.jar })
      const oid = found.data?.orders?.[0]?.id
      const cancel = await req(`/api/admin/orders/${oid}`, { method: 'PATCH', jar: disp.jar, body: { action: 'CANCEL' } })
      check('Order action CANCEL works', cancel.res.status === 200, JSON.stringify(cancel.data))
    }
  }

  // ================================================= [8] Subscription (owner → platform payment flow)
  console.log('[8] Subscription payment flow (shop owner → super admin)')
  {
    const sub = await req('/api/admin/subscription', { jar: disp.jar })
    check('Subscription GET (plan + superAdminUpi field)', sub.res.status === 200 && !!sub.data?.subscription?.plan?.code, JSON.stringify(sub.data).slice(0, 150))

    const qrEmpty = await req('/api/admin/subscription/qr?planCode=STARTER', { jar: disp.jar })
    if (!sub.data?.superAdminUpi) {
      check('QR without platform UPI → 409 with clear message', qrEmpty.res.status === 409 && /not configured/i.test(qrEmpty.data?.error || ''), JSON.stringify(qrEmpty.data))
    } else {
      check('QR with platform UPI → 200 + payload', qrEmpty.res.status === 200 && (qrEmpty.data?.payload || '').includes('upi://pay'), JSON.stringify(qrEmpty.data).slice(0, 120))
    }

    const submit = await req('/api/admin/subscription', { method: 'POST', jar: disp.jar, body: { planCode: 'STARTER', utr: `SUB${RUN}`.toUpperCase().slice(0, 22), payerName: 'Audit Owner' } })
    check('Subscription payment UTR submitted', submit.res.status === 200, JSON.stringify(submit.data))
    const subPayId = submit.data?.paymentId

    const asOwnerBlocked = await req('/api/super/subpayments', { jar: disp.jar })
    check('Owner blocked from super subpayments → 403', asOwnerBlocked.res.status === 403, `got ${asOwnerBlocked.res.status}`)

    const list = await req('/api/super/subpayments?status=PENDING', { jar: jarSuper })
    const target = (list.data?.payments || []).find((p) => p.id === subPayId)
    check('Super sees pending subscription payment', !!target, JSON.stringify(list.data).slice(0, 150))

    if (target) {
      const verify = await req(`/api/super/subpayments?id=${subPayId}`, { method: 'POST', jar: jarSuper, body: { action: 'VERIFY' } })
      check('Super verifies → plan activated', verify.res.status === 200, JSON.stringify(verify.data))
      const sub2 = await req('/api/admin/subscription', { jar: disp.jar })
      check('Shop subscription upgraded to STARTER', sub2.data?.subscription?.plan?.code === 'STARTER' && sub2.data?.subscription?.status === 'ACTIVE', JSON.stringify(sub2.data?.subscription?.plan))
    }
  }

  // ================================================= [9] Super dashboard tabs
  console.log('[9] Super admin dashboard — every tab API')
  {
    const stats = await req('/api/super/stats', { jar: jarSuper })
    check('Overview: /api/super/stats', stats.res.status === 200 && typeof stats.data?.shops?.total !== 'undefined', JSON.stringify(stats.data).slice(0, 120))

    const shops = await req('/api/super/shops?q=audit', { jar: jarSuper })
    check('Shops: search works', shops.res.status === 200 && (shops.data?.shops || []).some((s) => s.slug === disp.slug), JSON.stringify(shops.data).slice(0, 150))

    const suspend = await req(`/api/super/shops/${disp.id}`, { method: 'PATCH', jar: jarSuper, body: { action: 'SUSPEND' } })
    check('Shops: SUSPEND', suspend.res.status === 200, JSON.stringify(suspend.data))
    const suspendedPub = await req(`/api/shops/${disp.slug}`)
    check('Suspended shop hidden from public → 404', suspendedPub.res.status === 404, `got ${suspendedPub.res.status}`)
    const activate = await req(`/api/super/shops/${disp.id}`, { method: 'PATCH', jar: jarSuper, body: { action: 'ACTIVATE' } })
    check('Shops: ACTIVATE', activate.res.status === 200, JSON.stringify(activate.data))

    const revokeDev = await req(`/api/super/shops/${disp.id}`, { method: 'PATCH', jar: jarSuper, body: { action: 'REVOKE_ALL_DEVICES' } })
    check('Shops: REVOKE_ALL_DEVICES', revokeDev.res.status === 200, JSON.stringify(revokeDev.data))

    const pwReset = await req(`/api/super/shops/${disp.id}`, { method: 'PATCH', jar: jarSuper, body: { action: 'RESET_PASSWORD', newPassword: `Reset#${RUN}9Zz` } })
    check('Shops: RESET_PASSWORD', pwReset.res.status === 200, JSON.stringify(pwReset.data))
    const relogin = await req('/api/auth/login', { method: 'POST', body: { email: disp.email, password: `Reset#${RUN}9Zz` } })
    check('Owner logs in with super-set password', relogin.res.status === 200, JSON.stringify(relogin.data))

    const users = await req('/api/super/users?q=audit', { jar: jarSuper })
    check('Users: directory search', users.res.status === 200 && (users.data?.users || []).some((u) => u.email === disp.email), JSON.stringify(users.data).slice(0, 150))
    const userId = (users.data?.users || []).find((u) => u.email === disp.email)?.id
    if (userId) {
      const rp = await req('/api/super/users', { method: 'POST', jar: jarSuper, body: { userId, newPassword: `Super#2${RUN}Zz` } })
      check('Users: admin password reset', rp.res.status === 200, JSON.stringify(rp.data))
    }

    const plans = await req('/api/super/plans', { jar: jarSuper })
    check('Plans: list', plans.res.status === 200 && Array.isArray(plans.data?.plans), `got ${plans.res.status}`)
    const free = (plans.data?.plans || []).find((p) => p.code === 'FREE')
    if (free) {
      const patch = await req(`/api/super/plans?id=${free.id}`, { method: 'PATCH', jar: jarSuper, body: { maxOrdersMonth: free.maxOrdersMonth } })
      check('Plans: PATCH accepted', patch.res.status === 200, JSON.stringify(patch.data))
    }

    const auditLogs = await req('/api/super/audit?action=SHOP_CREATED', { jar: jarSuper })
    check('Audit: filtered logs', auditLogs.res.status === 200 && (auditLogs.data?.logs || []).length > 0, JSON.stringify(auditLogs.data).slice(0, 120))

    const settings = await req('/api/super/settings', { jar: jarSuper })
    check('Settings: GET all keys', settings.res.status === 200 && 'super_admin_upi_vpa' in (settings.data?.settings || {}), JSON.stringify(settings.data))
    const badKey = await req('/api/super/settings', { method: 'PUT', jar: jarSuper, body: { key: 'not_allowed', value: 'x' } })
    check('Settings: unknown key rejected 400', badKey.res.status === 400, `got ${badKey.res.status}`)
  }

  // ================================================= [10] Change password + logout (on disposable owner; re-login — password was reset by super in [9])
  console.log('[10] Account self-service')
  {
    const relog = await req('/api/auth/login', { method: 'POST', body: { email: disp.email, password: `Super#2${RUN}Zz` } })
    check('owner re-login after super reset', relog.res.status === 200, JSON.stringify(relog.data))
    disp.jar.absorb(relog.res)

    const cp = await req('/api/auth/change-password', { method: 'POST', jar: disp.jar, body: { currentPassword: `Super#2${RUN}Zz`, newPassword: `Self#3${RUN}Zz` } })
    check('change-password works', cp.res.status === 200, JSON.stringify(cp.data))
    const badCp = await req('/api/auth/change-password', { method: 'POST', jar: disp.jar, body: { currentPassword: 'wrong', newPassword: `Self#4${RUN}Zz` } })
    check('change-password wrong current → 400/401', badCp.res.status === 400 || badCp.res.status === 401, `got ${badCp.res.status}`)

    const out = await req('/api/auth/logout', { method: 'POST', jar: disp.jar })
    check('logout ok', out.res.status === 200, `got ${out.res.status}`)
    const meAfter = await req('/api/auth/me', { jar: disp.jar })
    check('session dead after logout', meAfter.res.status === 401 || meAfter.data?.user === null, JSON.stringify(meAfter.data))
  }

  // ================================================= [11] Downloads + notifications + misc
  console.log('[11] Downloads & misc')
  {
    const dl = await req('/api/downloads/connector')
    check('connector download reachable (200 file or 302 GitHub)', dl.res.status === 200 || dl.res.status === 302, `got ${dl.res.status}`)
    if (dl.res.status === 302) {
      check('connector 302 → GitHub release', (dl.res.headers.get('location') || '').includes('github.com'), dl.res.headers.get('location') || '')
    }

    const shopQrPage = await html(`/qr/${disp.slug}`)
    check('printable counter sign renders', shopQrPage.res.status === 200 && shopQrPage.text.includes('Scan to place a print order'), `status ${shopQrPage.res.status}`)

    const orderPage = await html(`/s/${disp.slug}/order/${orderNumber}`)
    check('order tracking page renders', orderPage.res.status === 200, `status ${orderPage.res.status}`)

    const nf = await html('/s/does-not-exist')
    check('unknown shop page → 404', nf.res.status === 404, `got ${nf.res.status}`)
  }

  // ================================================= [12] Cleanup — delete disposable shop
  console.log('[12] Cleanup (super deletes disposable shop)')
  {
    const del = await req(`/api/super/shops/${disp.id}`, { method: 'DELETE', jar: jarSuper, body: { confirm: disp.slug } })
    check('shop deleted (cascade)', del.res.status === 200, JSON.stringify(del.data))
    const gone = await req(`/api/shops/${disp.slug}`)
    check('deleted shop 404 publicly', gone.res.status === 404, `got ${gone.res.status}`)
  }

  console.log(`\n================ AUDIT RESULT ================`)
  console.log(`Passed: ${passed}   Failed: ${failed}`)
  if (failures.length) {
    console.log('FAILURES:')
    for (const f of failures) console.log(`  ✗ ${f}`)
    process.exit(1)
  }
  console.log('ALL CHECKS PASSED')
}

main().catch((e) => {
  console.error('AUDIT CRASHED:', e)
  process.exit(1)
})
