// LIVE verification of the tenant-isolation + backup/restore release.
// Runs entirely as a SHOP_ADMIN (created via self-serve /api/register) —
// the real owner's super-admin account is NEVER touched.
// Checks:
//  1. Excel backup (own shop) works for shop admin, 401 unauth
//  2. SYSTEM backup/restore APIs reject non-super users (isolation)
//  3. Business system backup: password-confirmed, chunked download,
//     gzip JSON, scope=SHOP, NO platform tables (users/billing) in dump
//  4. Restore roundtrip: pricing change reverted by restoring the backup
//  5. Cross-tenant rejection: a dump for another shop is refused
// Usage: node scripts/verify-backup-isolation.mjs <base_url>
const BASE = (process.argv[2] || 'https://copysahaayak.vercel.app').replace(/\/+$/, '')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
}
function cookieFrom(res) {
  const sc = res.headers.get('set-cookie') || ''
  const m = sc.match(/pcs_session=[^;]+/)
  return m ? m[0] : ''
}
async function api(path, opts = {}, cookie = null) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
    redirect: 'manual',
  })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, res }
}
const run = `bk${Date.now().toString(36)}`
const SHOP = { name: `BkTest Shop ${run}`, slug: `bktest-${run}`, ownerName: 'Backup Test', email: `owner-${run}@backup-test.local`, password: 'BackupTest1x' }
const PASS = SHOP.password

// 0. Register a temp shop (self-serve, TRIAL)
const reg = await api('/api/register', { method: 'POST', body: { ownerName: SHOP.ownerName, email: SHOP.email, password: PASS, shopName: SHOP.name, slug: SHOP.slug, shopPhone: '9800000000' } })
check('temp shop registered', reg.status === 200 || reg.status === 201, `status=${reg.status} ${JSON.stringify(reg.json?.error || '')}`)

const login = await api('/api/auth/login', { method: 'POST', body: { email: SHOP.email, password: PASS } })
const ck = cookieFrom(login.res)
check('shop admin login', login.status === 200 && !!ck, `status=${login.status}`)

// 1. Excel backup: own shop OK; unauth 401
const xl = await fetch(`${BASE}/api/admin/backup?range=month`, { headers: { Cookie: ck } })
const xlOk = xl.status === 200 && (xl.headers.get('content-type') || '').includes('spreadsheet')
check('Excel backup (own shop) downloads', xlOk, `status=${xl.status}`)
await xl.arrayBuffer().catch(() => null)
const xlUn = await fetch(`${BASE}/api/admin/backup?range=month`)
check('Excel backup unauthenticated → 401', xlUn.status === 401, `status=${xlUn.status}`)

// 2. Isolation: SYSTEM endpoints refuse non-super
const sysBk = await api('/api/super/system-backup', { method: 'POST', body: { password: PASS } }, ck)
check('SYSTEM backup refuses SHOP_ADMIN (isolation)', sysBk.status === 403, `status=${sysBk.status}`)
const sysRs = await api('/api/super/system-restore', { method: 'POST', body: { action: 'begin', parts: 1 } }, ck)
check('SYSTEM restore refuses SHOP_ADMIN (isolation)', sysRs.status === 403, `status=${sysRs.status}`)
const xlSuper = await fetch(`${BASE}/api/admin/backup?range=month&shopId=x&platform=1`, { headers: { Cookie: ck } })
check('Excel super-paths gone for shop admin', xlSuper.status === 200, `status=${xlSuper.status}`)

// 3. Business system backup: wrong password → 403; correct → job
const wrong = await api('/api/admin/shop-backup', { method: 'POST', body: { password: 'WrongPass1x' } }, ck)
check('backup with wrong password → 403', wrong.status === 403, `status=${wrong.status}`)
const bk = await api('/api/admin/shop-backup', { method: 'POST', body: { password: PASS } }, ck)
check('backup job created (password-confirmed)', bk.status === 200 && bk.json?.jobId, `status=${bk.status} parts=${bk.json?.parts}`)
const { jobId, parts, filename } = bk.json || {}

// Fetch all chunks, assemble, verify
let dump = null
if (jobId) {
  const collected = []
  let fetchOk = true
  for (let i = 0; i < parts; i++) {
    const p = await api(`/api/admin/shop-backup?jobId=${jobId}&part=${i}`, {}, ck)
    if (p.status !== 200 || !p.json?.payload) { fetchOk = false; break }
    collected.push(p.json.payload)
  }
  check('all chunks fetched', fetchOk, `parts=${parts}`)
  const gz = Buffer.from(collected.join(''), 'base64')
  const magicOk = gz[0] === 0x1f && gz[1] === 0x8b
  check('file is gzip (magic bytes)', magicOk, `size=${gz.length}`)
  try {
    const { gunzipSync } = await import('zlib')
    dump = JSON.parse(gunzipSync(gz).toString('utf8'))
    check('valid backup JSON', !!dump?.format, `scope=${dump?.scope}`)
    check('dump scope=SHOP + own shopId', dump?.scope === 'SHOP' && dump?.header?.shopId, `shopId=${dump?.header?.shopId}`)
    const tableNames = Object.keys(dump?.tables || {})
    const leaked = tableNames.filter((t) => ['User', 'Session', 'Subscription', 'SubscriptionPayment', 'ShopMember', 'Plan', 'PlatformSetting'].includes(t))
    check('NO platform tables in shop dump (logins/billing excluded)', leaked.length === 0, `tables=${tableNames.join(',')}`)
    check('filename has date', /Backup-\d{8}-\d{4}/.test(filename || ''), filename || '')
  } catch (e) {
    check('valid backup JSON', false, String(e).slice(0, 80))
  }
  const del = await api(`/api/admin/shop-backup?jobId=${jobId}`, { method: 'DELETE' }, ck)
  check('backup job cleaned up', del.status === 200, `status=${del.status}`)
}

// 4. Restore roundtrip: change pricing → restore → pricing reverted
const pricingBefore = await api('/api/admin/pricing', {}, ck)
const rule = (pricingBefore.json?.rules || [])[0]
let roundtripDone = false
if (rule && dump) {
  const newPrice = (rule.singleSidedPaise || 100) + 7
  const upd = await api('/api/admin/pricing', { method: 'PUT', body: { rules: [{ paperSize: rule.paperSize, colorMode: rule.colorMode, singleSidedPaise: newPrice, duplexPaise: Math.min(rule.duplexPaise, newPrice) }] } }, ck)
  check('pricing changed (setup for roundtrip)', upd.status === 200 || upd.status === 201, `status=${upd.status} ${JSON.stringify(upd.json?.error || '')}`)
  // upload backup for restore
  const { gzipSync } = await import('zlib')
  const gz = gzipSync(Buffer.from(JSON.stringify(dump), 'utf8'))
  const b64 = gz.toString('base64')
  const PART = 1_400_000
  const nParts = Math.max(1, Math.ceil(b64.length / PART))
  const begin = await api('/api/admin/shop-restore', { method: 'POST', body: { action: 'begin', parts: nParts } }, ck)
  const rJobId = begin.json?.jobId
  check('restore begin', begin.status === 200 && !!rJobId, `status=${begin.status}`)
  if (rJobId) {
    let upOk = true
    for (let i = 0; i < nParts; i++) {
      const pr = await api('/api/admin/shop-restore', { method: 'POST', body: { action: 'part', jobId: rJobId, idx: i, payload: b64.slice(i * PART, (i + 1) * PART) } }, ck)
      if (pr.status !== 200) { upOk = false; break }
    }
    check('restore parts uploaded', upOk, `parts=${nParts}`)
    const commit = await api('/api/admin/shop-restore', { method: 'POST', body: { action: 'commit', jobId: rJobId, password: PASS } }, ck)
    check('restore committed', commit.status === 200 && commit.json?.restored === true, `status=${commit.status} ${JSON.stringify(commit.json?.error || '')}`)
    const pricingAfter = await api('/api/admin/pricing', {}, ck)
    const ruleAfter = (pricingAfter.json?.rules || []).find((r) => r.paperSize === rule.paperSize && r.colorMode === rule.colorMode)
    roundtripDone = ruleAfter && ruleAfter.singleSidedPaise === rule.singleSidedPaise
    check('ROUNDTRIP: pricing reverted to backup value', !!roundtripDone, `now=${ruleAfter?.singleSidedPaise} expected=${rule.singleSidedPaise}`)
  }
} else {
  check('pricing roundtrip', false, 'no pricing rule or no dump')
}

// 5. Cross-tenant rejection: dump for another shop
{
  const { gzipSync } = await import('zlib')
  const forged = dump ? { ...dump, header: { ...dump.header, shopId: 'other-shop-id-123' } } : { format: 'copysahaayak-backup', version: 3, scope: 'SHOP', createdAt: new Date().toISOString(), header: { shopId: 'other-shop-id-123' }, tables: { Shop: [{}], Order: [] } }
  const gz = gzipSync(Buffer.from(JSON.stringify(forged), 'utf8'))
  const b64 = gz.toString('base64')
  const begin = await api('/api/admin/shop-restore', { method: 'POST', body: { action: 'begin', parts: 1 } }, ck)
  const rJobId = begin.json?.jobId
  await api('/api/admin/shop-restore', { method: 'POST', body: { action: 'part', jobId: rJobId, idx: 0, payload: b64 } }, ck)
  const commit = await api('/api/admin/shop-restore', { method: 'POST', body: { action: 'commit', jobId: rJobId, password: PASS } }, ck)
  check('cross-shop restore REFUSED (isolation)', commit.status === 400, `status=${commit.status} msg=${commit.json?.error || ''}`)
}

// Cleanup note: temp shop remains (TRIAL) — super admin deletes it in Shops tab.
console.log(`\nTEMP SHOP: ${SHOP.slug} (${SHOP.email}) — platform admin se Shops tab me delete kar dein.\n`)
const failed = results.filter((r) => !r.ok)
console.log(`==== ${results.length - failed.length}/${results.length} checks passed ====`)
process.exit(failed.length ? 1 : 0)
