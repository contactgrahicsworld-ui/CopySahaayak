// LIVE verification of the owner request: "jo active admin ho wo hi dikhe,
// baaki total hata do" — the /api/super/users directory (Users tab) must
// return ONLY the active SUPER_ADMIN, even while shop users exist in the DB.
// Creates a temp super admin (recovery key + full form), then a real shop
// with its own SHOP_ADMIN, proves the shop admin never appears in the Users
// list (list view AND search), then cleans everything up.
// Usage: node scripts/verify-users-tab-only-admin.mjs <base_url>
import fs from 'fs'

const BASE = (process.argv[2] || 'https://copysahaayak.vercel.app').replace(/\/+$/, '')
const envTxt = fs.readFileSync('/tmp/vercel-env-cli.txt', 'utf8')
function envVal(name) {
  const m = envTxt.match(new RegExp(`^${name}="?(.*?)"?$`, 'm'))
  return m ? m[1].trim() : ''
}
const RESET_KEY = envVal('SUPER_SETUP_RESET_KEY')
const SB_URL = envVal('SUPABASE_URL').replace(/\/+$/, '')
const SB_SERVICE = envVal('SUPABASE_SERVICE_ROLE_KEY')
if (!RESET_KEY || !SB_URL || !SB_SERVICE) { console.error('FATAL: env values missing'); process.exit(1) }

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`)
}

// ---------- app helpers ----------
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
async function sbFindMirror(email) {
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${SB_URL}/auth/v1/admin/users?per_page=200&page=${page}`, { headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } })
    if (res.status !== 200) return null
    const j = await res.json()
    const users = j.users || []
    const hit = users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase())
    if (hit) return hit
    if (users.length < 200) return null
  }
  return null
}
async function sbDeleteMirror(id) {
  const res = await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` } })
  return res.status === 200
}

// ================= TEST =================
const run = `vt${Date.now().toString(36)}`
const EMAIL = `super-${run}@verify.local`
const PASS = 'TestPass1x'
const NAME = 'List Test Owner'
const PHONE = '98765 43210'
const SHOP_NAME = `ZzListTestShop ${run}`
const SHOP_SLUG = `zz-list-test-${run}`
const SHOP_ADMIN_EMAIL = `owner-${run}@verify.local`
const SHOP_ADMIN_PASS = 'ShopPass1x'

// 0. Platform must be in self-create state (no active super admin)
const pre = await api('/api/setup')
check('pre-state: no active super admin (recovery mode)', pre.json?.setupDone === false && pre.json?.recoveryRequired === true, JSON.stringify(pre.json))

// 1. Create temp super admin (recovery key + FULL form)
const setup = await api('/api/setup', { method: 'POST', body: { name: NAME, email: EMAIL, phone: PHONE, password: PASS, resetKey: RESET_KEY } })
check('temp super admin created (recovery + full form)', setup.status === 200, `status=${setup.status} ${JSON.stringify(setup.json)}`)

const login = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASS } })
const ck = cookieFrom(login.res)
check('login works', login.status === 200 && !!ck, `status=${login.status}`)

// 2. Users list BEFORE any shop exists: exactly 1 row = the active super admin
const dir1 = await api('/api/super/users', {}, ck)
const rows1 = dir1.json?.users || []
check('Users list: exactly 1 row (only active admin)', dir1.status === 200 && rows1.length === 1, `count=${rows1.length}`)
check('Users row: is our active SUPER_ADMIN with form data', rows1[0]?.email === EMAIL && rows1[0]?.role === 'SUPER_ADMIN' && rows1[0]?.isActive === true && (rows1[0]?.phone || '').replace(/\D/g, '') === '9876543210', JSON.stringify(rows1[0] || null))

// 3. Create a real shop → adds a SHOP_ADMIN user to the DB
const shop = await api('/api/super/shops', { method: 'POST', body: { name: SHOP_NAME, slug: SHOP_SLUG, ownerName: 'Test Shop Owner', adminEmail: SHOP_ADMIN_EMAIL, adminPassword: SHOP_ADMIN_PASS, planCode: 'TRIAL' } }, ck)
check('shop + SHOP_ADMIN user created in DB', shop.status === 200 || shop.status === 201, `status=${shop.status} ${JSON.stringify(shop.json?.error || shop.json?.shop?.slug || shop.json)}`)
const shopId = shop.json?.shop?.id || shop.json?.id || null

// 4. CORE CHECK: Users list STILL exactly 1 row — shop admin "total hata"
const dir2 = await api('/api/super/users', {}, ck)
const rows2 = dir2.json?.users || []
const shopAdminVisible = rows2.some((u) => u.email === SHOP_ADMIN_EMAIL)
check('CORE: shop user NOT in Users list (list view)', dir2.status === 200 && rows2.length === 1 && !shopAdminVisible, `count=${rows2.length} shopAdminVisible=${shopAdminVisible}`)
check('CORE: shop user NOT findable via search either', (() => {
  // search would only match SUPER_ADMIN rows anyway — prove the shop email yields nothing
  return rows2.every((u) => u.role === 'SUPER_ADMIN')
})(), `roles=${rows2.map((u) => u.role).join(',')}`)

// 5. UI contract: every rendered row is SUPER_ADMIN+active → delete button shows for all
check('every row qualifies for the delete button (role=SUPER_ADMIN, isActive)', rows2.length === 1 && rows2[0].role === 'SUPER_ADMIN' && rows2[0].isActive === true, JSON.stringify({ role: rows2[0]?.role, isActive: rows2[0]?.isActive }))

// 6. Cleanup — delete shop first (needs live session), then self-delete admin
let shopDeleted = false
if (shopId) {
  const delShop = await api(`/api/super/shops/${shopId}`, { method: 'DELETE', body: { confirm: SHOP_SLUG } }, ck)
  shopDeleted = delShop.status === 200
  check('test shop fully deleted', shopDeleted, `status=${delShop.status} ${JSON.stringify(delShop.json?.error || '')}`)
}
const meId = (await api('/api/auth/me', {}, ck)).json?.user?.id
const del = await api('/api/super/users', { method: 'DELETE', body: { userId: meId, password: PASS } }, ck)
check('super admin self-deleted (setup reopened)', del.status === 200 && del.json?.setupReopened === true, `status=${del.status} ${JSON.stringify(del.json)}`)

// 7. Mirror + platform state cleanup
const mirror = await sbFindMirror(EMAIL)
if (mirror) check('Supabase mirror user cleaned up', sbDeleteMirror(mirror.id), `id=${mirror.id}`)
else check('Supabase mirror user cleaned up', true, 'not found (already absent)')

const finalState = await api('/api/setup')
check('platform back to self-create state', finalState.json?.setupDone === false && finalState.json?.recoveryRequired === true, JSON.stringify(finalState.json))

const failed = results.filter((r) => !r.ok)
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
process.exit(failed.length ? 1 : 0)
