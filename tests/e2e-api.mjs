// End-to-end API + security test — run: bun tests/e2e-api.mjs  (or node with fetch support)
// Exercises the real HTTP surface of the running server, including setup,
// registration, guest ordering, cross-tenant attacks and the device pipeline.
// Credentials are created DYNAMICALLY via /setup and /register — nothing predefined.
// Exits non-zero on any failure.
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const RUN = Math.random().toString(36).slice(2, 8) // unique per run → re-runnable

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

// Minimal cookie jar
class Jar {
  constructor() {
    this.cookies = new Map()
  }
  absorb(res) {
    const set = res.headers.getSetCookie?.() || []
    for (const c of set) {
      const [pair] = c.split(';')
      const eq = pair.indexOf('=')
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
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
  try {
    data = await res.json()
  } catch {}
  return { res, data }
}

async function main() {
  console.log(`E2E against ${BASE}  (run id ${RUN})\n`)

  // Reset rate-limit buckets (dev-only endpoint) so repeated runs stay deterministic.
  try {
    await req('/api/test/reset', { method: 'POST' })
  } catch {}

  const SUPER = { email: `super.e2e.${RUN}@copysahaayak-test.in`, password: `SuperE2E#${RUN}1A`, name: 'E2E Platform Owner' }
  const UPI = `e2e${RUN}@oktestbank`
  const SHOP_A = { email: `owner.a.${RUN}@testshop-test.in`, password: `ShopE2E#${RUN}1A`, ownerName: 'E2E Owner A', shopName: `E2E Xerox A ${RUN}`, slug: `e2e-a-${RUN}`, upiVpa: UPI, upiPayeeName: 'E2E Shop A' }
  const SHOP_B = { email: `owner.b.${RUN}@testshop-test.in`, password: `ShopE2E#${RUN}1B`, ownerName: 'E2E Owner B', shopName: `E2E Xerox B ${RUN}`, slug: `e2e-b-${RUN}`, upiVpa: UPI }

  // ---------- 1. Health ----------
  console.log('[1] Health & public surfaces')
  {
    const { res, data } = await req('/api/health')
    check('health endpoint reports healthy', res.status === 200 && data.database === 'up', JSON.stringify(data))
    const { res: r3 } = await req('/api/shops/does-not-exist')
    check('unknown shop 404s', r3.status === 404)
  }

  // ---------- 2. One-time setup + shop registration ----------
  console.log('[2] Setup (first super admin) & shop self-registration')
  const jarS = new Jar()
  {
    const status = await req('/api/setup')
    if (status.data?.setupDone) {
      check('setup already done on this deployment', true)
    } else {
      const s = await req('/api/setup', { method: 'POST', body: SUPER })
      check('first super admin created via /setup', s.res.status === 200, JSON.stringify(s.data))
      const again = await req('/api/setup', { method: 'POST', body: { name: 'x', email: `z.${RUN}@x.in`, password: 'Whatever#123' } })
      check('setup locked after first account (403)', again.res.status === 403, `got ${again.res.status}`)
    }
    const loginS = await req('/api/auth/login', { method: 'POST', body: { email: process.env.E2E_SUPER_EMAIL || SUPER.email, password: process.env.E2E_SUPER_PASSWORD || SUPER.password }, jar: jarS })
    check('super admin login ok', loginS.res.status === 200 && loginS.data.user?.role === 'SUPER_ADMIN', loginS.res.status !== 200 && !process.env.E2E_SUPER_EMAIL && status.data?.setupDone ? 'deployment already set up — set E2E_SUPER_EMAIL / E2E_SUPER_PASSWORD' : JSON.stringify(loginS.data))
    if (loginS.res.status !== 200 && process.env.E2E_SUPER_EMAIL) {
      // deployment already had a super admin — continue with provided creds
    }

    const regA = await req('/api/register', { method: 'POST', body: SHOP_A })
    check('shop A registered (auto signed-in)', regA.res.status === 200 && regA.data.user?.role === 'SHOP_ADMIN', JSON.stringify(regA.data))
    const dupSlug = await req('/api/register', { method: 'POST', body: { ...SHOP_B, slug: SHOP_A.slug } })
    check('duplicate shop slug rejected 409', dupSlug.res.status === 409, `got ${dupSlug.res.status}`)
    const dupEmail = await req('/api/register', { method: 'POST', body: { ...SHOP_B, email: SHOP_A.email } })
    check('duplicate owner email rejected 409', dupEmail.res.status === 409, `got ${dupEmail.res.status}`)
    const regB = await req('/api/register', { method: 'POST', body: SHOP_B })
    check('shop B registered', regB.res.status === 200, JSON.stringify(regB.data))

    // weak passwords rejected
    const weak = await req('/api/register', { method: 'POST', body: { ...SHOP_B, email: `weak.${RUN}@x.in`, slug: `weak-${RUN}`, password: 'short1' } })
    check('weak password rejected 400', weak.res.status === 400, `got ${weak.res.status}`)
  }

  // ---------- 3. Logins ----------
  console.log('[3] Authentication')
  const jarA = new Jar()
  const jarB = new Jar()
  {
    const loginA = await req('/api/auth/login', { method: 'POST', body: { email: SHOP_A.email, password: SHOP_A.password }, jar: jarA })
    check('shop A login ok', loginA.res.status === 200 && loginA.data.user?.role === 'SHOP_ADMIN', JSON.stringify(loginA.data))
    const bad = await req('/api/auth/login', { method: 'POST', body: { email: SHOP_A.email, password: 'wrong-password' }, jar: new Jar() })
    check('wrong password rejected with 401', bad.res.status === 401)
    const loginB = await req('/api/auth/login', { method: 'POST', body: { email: SHOP_B.email, password: SHOP_B.password }, jar: jarB })
    check('shop B login ok', loginB.res.status === 200)
    const me = await req('/api/auth/me', { jar: jarS })
    check('super admin session valid', me.data?.user?.role === 'SUPER_ADMIN')
    const unauth = await req('/api/admin/orders')
    check('admin API without session → 401', unauth.res.status === 401)
    const publicShop = await req(`/api/shops/${SHOP_A.slug}`)
    check('public shop info loads with 8 default pricing rules', publicShop.res.status === 200 && publicShop.data?.pricing?.length === 8, JSON.stringify(publicShop.data?.pricing?.length))
  }

  // ---------- 4. Forgot password (email OTP via Supabase) ----------
  console.log('[4] Password reset flow')
  {
    const unknown = await req('/api/auth/forgot', { method: 'POST', body: { email: `ghost.${RUN}@nowhere.in` } })
    check('forgot: unknown email → silent 200 (no enumeration)', unknown.res.status === 200, JSON.stringify(unknown.data))
    const known = await req('/api/auth/forgot', { method: 'POST', body: { email: SHOP_A.email } })
    // 200 = OTP email sent via Supabase; 502 = Supabase unreachable/paused (graceful).
    check(
      'forgot: known email → 200 (mail sent) or graceful 502',
      known.res.status === 200 || known.res.status === 502,
      `got ${known.res.status}`,
    )
    const badCode = await req('/api/auth/reset', { method: 'POST', body: { email: SHOP_A.email, code: '000000', password: 'NewPass#1234' } })
    check('reset: wrong code → 400/502 (never 500)', badCode.res.status === 400 || badCode.res.status === 502, `got ${badCode.res.status}`)
  }

  // ---------- 5. Customer order flow ----------
  console.log('[5] Customer order flow (guest session → upload → order → UPI → UTR)')
  let orderNumber, documentId, fileUrl
  {
    const jarCustomer = new Jar()
    const s2 = await req(`/api/shops/${SHOP_A.slug}/session`, { method: 'POST', body: { name: 'Test Customer', phone: '9820011223' }, jar: jarCustomer })
    check('guest customer session created', s2.res.status === 200)

    // Build a real 3-page PDF in-memory
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (let i = 1; i <= 3; i++) {
      const page = pdf.addPage([595, 842])
      page.drawText(`Test page ${i}`, { x: 60, y: 700, size: 28, font })
    }
    const pdfBytes = Buffer.from(await pdf.save())

    const form = new FormData()
    form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'test-doc.pdf')
    const up = await req(`/api/shops/${SHOP_A.slug}/uploads`, { method: 'POST', body: form, jar: jarCustomer })
    check('PDF upload accepted', up.res.status === 200, JSON.stringify(up.data))
    check('server counted 3 pages', up.data?.pageCount === 3)
    documentId = up.data?.documentId
    fileUrl = up.data?.previewUrl

    // Malicious file rejected
    const evil = new FormData()
    evil.append('file', new Blob([Buffer.from('<html><body>x</body></html>')], { type: 'application/pdf' }), 'evil.pdf')
    const evilRes = await req(`/api/shops/${SHOP_A.slug}/uploads`, { method: 'POST', body: evil, jar: jarCustomer })
    check('HTML masquerading as PDF rejected 415', evilRes.res.status === 415)

    // Signed URL works; tampered signature fails
    if (fileUrl) {
      const f = await fetch(`${BASE}${fileUrl}`)
      check('signed preview URL serves the PDF', f.status === 200 && f.headers.get('content-type') === 'application/pdf')
      const tampered = await fetch(`${BASE}/api/files/${documentId}?exp=99999999999999&sig=forged`)
      check('forged file signature → 403', tampered.status === 403)
    }

    // Place order: 3 sides × 2 copies × ₹2 = ₹12.00 = 1200 paise
    const ord = await req(`/api/shops/${SHOP_A.slug}/orders`, {
      method: 'POST',
      jar: jarCustomer,
      body: { customerName: 'Test Customer', customerPhone: '9820011223', items: [{ documentId, colorMode: 'BW', paperSize: 'A4', duplex: false, copies: 2 }] },
    })
    check('order created', ord.res.status === 200, JSON.stringify(ord.data))
    check('server-computed total is ₹12.00 (1200 paise)', ord.data?.totalPaise === 1200, `got ${ord.data?.totalPaise}`)
    check('UPI payload returned with exact amount', ord.data?.upi?.payload?.includes('am=12.00'))
    check('QR data URL returned', ord.data?.qrDataUrl?.startsWith('data:image/png'))
    orderNumber = ord.data?.orderNumber

    // Document from another shop's customer cannot be ordered
    const jarCustomerB = new Jar()
    await req(`/api/shops/${SHOP_B.slug}/session`, { method: 'POST', body: {}, jar: jarCustomerB })
    const crossOrder = await req(`/api/shops/${SHOP_B.slug}/orders`, {
      method: 'POST',
      jar: jarCustomerB,
      body: { items: [{ documentId, colorMode: 'BW', paperSize: 'A4', duplex: false, copies: 1 }] },
    })
    check('cross-tenant order with foreign documentId rejected', crossOrder.res.status >= 400, JSON.stringify(crossOrder.data))

    // Submit UTR
    const utr = await req(`/api/shops/${SHOP_A.slug}/orders/${orderNumber}/utr`, { method: 'POST', jar: jarCustomer, body: { utr: `UTR${Date.now()}`.slice(0, 22), payerName: 'Test Customer' } })
    check('UTR submission accepted', utr.res.status === 200, JSON.stringify(utr.data))
    const dupUtr = await req(`/api/shops/${SHOP_A.slug}/orders/${orderNumber}/utr`, { method: 'POST', jar: jarCustomer, body: { utr: 'UTR9988776656' } })
    check('duplicate UTR submission rejected 409', dupUtr.res.status === 409)

    // Customer tracking works
    const track2 = await fetch(`${BASE}/api/shops/${SHOP_A.slug}/orders/${orderNumber}?phone=9820011223`)
    const t2 = await track2.json()
    check('customer tracks own order (AWAITING_VERIFICATION)', t2?.status === 'AWAITING_VERIFICATION', `got ${t2?.status}`)
  }

  // ---------- 6. Cross-tenant isolation (attacks) ----------
  console.log('[6] Cross-tenant isolation attacks')
  {
    const listB = await req('/api/admin/orders', { jar: jarB })
    const leak = listB.data?.orders?.some((o) => o.orderNumber === orderNumber)
    check('shop B cannot see shop A orders in list', !leak)

    const orderRowsA = await req('/api/admin/orders', { jar: jarA })
    const orderA = orderRowsA.data?.orders?.find((o) => o.orderNumber === orderNumber)
    check('shop A sees its own order', !!orderA)

    // shop B tries to verify shop A's payment (IDOR)
    if (orderA) {
      const payA = await req('/api/admin/payments?status=ALL', { jar: jarA })
      const paymentA = payA.data?.payments?.find((p) => p.order.orderNumber === orderNumber)
      check('shop A sees its payment', !!paymentA)
      if (paymentA) {
        const stolen = await req(`/api/admin/payments/${paymentA.id}`, { method: 'POST', jar: jarB, body: { action: 'VERIFY' } })
        check('shop B verifying shop A payment → 404', stolen.res.status === 404, `got ${stolen.res.status}`)
        const superView = await req('/api/admin/payments?status=ALL', { jar: jarS })
        check('super admin blocked from shop-admin API', superView.res.status === 403)
      }
      const patchB = await req(`/api/admin/orders/${orderA.id}`, { method: 'PATCH', jar: jarB, body: { action: 'CANCEL' } })
      check('shop B cancelling shop A order → 404', patchB.res.status === 404)
    }

    // shop B pricing isolation
    const pricingB = await req('/api/admin/pricing', { jar: jarB })
    check('shop B pricing isolated', pricingB.res.status === 200 && pricingB.data.rules.every((r) => r.shopId))
  }

  // ---------- 7. Payment verification → print job fan-out ----------
  console.log('[7] Payment verification & print pipeline (device API)')
  let deviceToken = null
  {
    // Pair a device for shop A
    const pair = await req('/api/admin/devices', { method: 'POST', jar: jarA, body: { name: 'Test Connector' } })
    check('pairing code issued', pair.res.status === 200 && /^[A-Z0-9]{6}$/.test(pair.data?.device?.pairingCode || ''), JSON.stringify(pair.data))
    const code = pair.data.device.pairingCode

    const dp = await req('/api/device/pair', { method: 'POST', body: { pairingCode: code, machineName: `E2E-PC-${RUN}`, appVersion: '1.0.0' } })
    check('device paired, token issued', dp.res.status === 200 && !!dp.data?.deviceToken, JSON.stringify(dp.data))
    deviceToken = dp.data.deviceToken
    const devH = { Authorization: `Bearer ${deviceToken}` }

    // Heartbeat registers printers
    const hb = await req('/api/device/heartbeat', { method: 'POST', headers: devH, body: { appVersion: '1.0.0', printers: [{ windowsName: 'E2E LaserJet BW', colorMode: 'BW', paperSizes: ['A4'] }] } })
    check('heartbeat registers printer', hb.res.status === 200 && hb.data?.ok === true, JSON.stringify(hb.data))

    // Bad pairing code rejected
    const badPair = await req('/api/device/pair', { method: 'POST', body: { pairingCode: 'ZZZZZZ', machineName: 'x' } })
    check('invalid pairing code rejected', badPair.res.status === 401)
    // Bad device token rejected
    const badDev = await req('/api/device/jobs/claim', { method: 'POST', headers: { Authorization: 'Bearer bogus' }, body: {} })
    check('bogus device token → 401', badDev.res.status === 401)

    // Verify payment as shop A → job queued
    const payA = await req('/api/admin/payments?status=SUBMITTED', { jar: jarA })
    const paymentA = payA.data?.payments?.find((p) => p.order.orderNumber === orderNumber)
    check('shop A sees submitted payment', !!paymentA && paymentA.order.orderNumber === orderNumber)
    const verify = await req(`/api/admin/payments/${paymentA.id}`, { method: 'POST', jar: jarA, body: { action: 'VERIFY', note: 'e2e verified' } })
    check('payment verified', verify.res.status === 200, JSON.stringify(verify.data))

    // Claim job
    const claim = await req('/api/device/jobs/claim', { method: 'POST', headers: devH, body: {} })
    check('device claims the print job', claim.res.status === 200 && claim.data?.job?.id, JSON.stringify(claim.data))
    const job = claim.data?.job
    check('job carries correct copies/paper/mode', job?.printSettings?.copies === 2 && job?.printSettings?.paperSize === 'A4' && job?.printSettings?.colorMode === 'BW')
    check('job has a signed download URL', typeof job?.document?.downloadUrl === 'string' && job.document.downloadUrl.includes('sig='))
    if (job) {
      const dl = await fetch(`${BASE}${job.document.downloadUrl}`)
      check('device can download the document', dl.status === 200)

      // Honesty rule: COMPLETED before SPOOLING must be rejected
      const fake = await req(`/api/device/jobs/${job.id}/events`, { method: 'POST', headers: devH, body: { status: 'COMPLETED' } })
      check('COMPLETED without SPOOLING rejected 409 (no fake printing)', fake.res.status === 409, `got ${fake.res.status}`)

      const spool = await req(`/api/device/jobs/${job.id}/events`, { method: 'POST', headers: devH, body: { status: 'SPOOLING' } })
      check('SPOOLING accepted', spool.res.status === 200)
      const done = await req(`/api/device/jobs/${job.id}/events`, { method: 'POST', headers: devH, body: { status: 'COMPLETED' } })
      check('COMPLETED after spooling accepted', done.res.status === 200)

      const track2 = await fetch(`${BASE}/api/shops/${SHOP_A.slug}/orders/${orderNumber}?phone=9820011223`)
      const t2 = await track2.json()
      check('order auto-completed after all jobs printed', t2?.status === 'COMPLETED', `got ${t2?.status}`)
    }
  }

  // ---------- 8. Device revocation ----------
  console.log('[8] Device revocation')
  {
    if (deviceToken) {
      const devs = await req('/api/admin/devices', { jar: jarA })
      const dev = devs.data?.devices?.find((d) => d.machineName === `E2E-PC-${RUN}`)
      if (dev) {
        const rev = await req(`/api/admin/devices/${dev.id}`, { method: 'DELETE', jar: jarA })
        check('device revoked', rev.res.status === 200)
        const useAfter = await req('/api/device/jobs/claim', { method: 'POST', headers: { Authorization: `Bearer ${deviceToken}` }, body: {} })
        check('revoked device token no longer works', useAfter.res.status === 401, `got ${useAfter.res.status}`)
      }
    }
  }

  // ---------- 9. Super admin subscription flow ----------
  console.log('[9] Subscription payment verification (Super Admin)')
  {
    const stats = await req('/api/super/stats', { jar: jarS })
    check('super stats load', stats.res.status === 200 && stats.data?.shops?.total >= 2)
    // Shop B submits a fresh renewal payment so this suite is re-runnable
    const utr = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 22)
    await req('/api/admin/subscription', { method: 'POST', jar: jarB, body: { planCode: 'PROFESSIONAL', utr, payerName: 'E2E shop B' } })
    const pending = await req('/api/super/subpayments?status=PENDING', { jar: jarS })
    const target = pending.data?.payments?.find((p) => p.shop.slug === SHOP_B.slug)
    check('pending subscription payment visible', !!target)
    if (target) {
      const v = await req(`/api/super/subpayments?id=${target.id}`, { method: 'POST', jar: jarS, body: { action: 'VERIFY' } })
      check('subscription verified & activated', v.res.status === 200)
      const subs = await req('/api/super/shops', { jar: jarS })
      const shopB = subs.data?.shops?.find((s) => s.slug === SHOP_B.slug)
      check('shop B subscription now ACTIVE Professional', shopB?.subscription?.status === 'ACTIVE' && shopB?.subscription?.plan?.code === 'PROFESSIONAL', JSON.stringify(shopB?.subscription))
    }
    // Audit log recorded
    const audit = await req('/api/super/audit?action=SUBSCRIPTION', { jar: jarS })
    check('audit trail captured subscription verification', audit.data?.logs?.length > 0)
    // Super APIs denied for shop admin
    const denied = await req('/api/super/stats', { jar: jarA })
    check('shop admin blocked from super APIs', denied.res.status === 403)
  }

  // ---------- 10. Rate limiting ----------
  console.log('[10] Rate limiting')
  {
    let lastStatus = 0
    for (let i = 0; i < 12; i++) {
      const r = await req('/api/auth/login', { method: 'POST', body: { email: `bf.${RUN}@nowhere.in`, password: 'wrong-password-x' } })
      lastStatus = r.res.status
      if (r.res.status === 429) break
    }
    check('login brute force rate-limited (429)', lastStatus === 429, `last status ${lastStatus}`)
  }

  console.log(`\n========== RESULTS: ${passed} passed, ${failed} failed ==========`)
  if (failures.length) {
    console.log('Failures:')
    for (const f of failures) console.log('  ✗ ' + f)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error('E2E crashed:', e)
  process.exit(1)
})
