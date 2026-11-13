// Post-deploy LIVE verification — strictly NON-DESTRUCTIVE (no login, no data writes).
// Checks: health, login page, backup/restore routes exist (401/403 = auth-gated, 404 = missing),
// security headers, legal pages, tenant isolation surface (super API unauthorized = 401).
const BASE = process.env.LIVE_BASE || 'https://copysahaayak.vercel.app'
let pass = 0, fail = 0
const results = []

function check(name, ok, detail) {
  results.push({ name, ok, detail })
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`)
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, { redirect: 'manual', ...opts })
  return res
}

const health = await (await req('/api/health')).json().catch(() => null)
check('health: status=healthy', health?.status === 'healthy', JSON.stringify(health?.status))
check('health: database=up', health?.database === 'up', String(health?.database))

const superLogin = await req('/super/login')
check('super/login reachable', superLogin.status === 200, String(superLogin.status))

const login = await req('/login')
check('/login reachable', login.status === 200, String(login.status))

const home = await req('/')
const csp = home.headers.get('content-security-policy') || ''
const hsts = home.headers.get('strict-transport-security') || ''
const xcto = home.headers.get('x-content-type-options') || ''
const frame = home.headers.get('x-frame-options') || home.headers.get('content-security-policy')?.includes('frame-ancestors')
check('security: CSP header', csp.includes("default-src 'self'"), csp.slice(0, 60))
check('security: HSTS', hsts.includes('max-age=31536000'), hsts)
check('security: nosniff', xcto === 'nosniff', xcto)
check('security: frame guard', Boolean(frame), String(frame))

const terms = await req('/terms')
check('/terms 200', terms.status === 200, String(terms.status))
const privacy = await req('/privacy')
check('/privacy 200', privacy.status === 200, String(privacy.status))

// Backup/restore routes: MUST exist (401/403 without auth) — 404 means deploy missing
const shopBk = await req('/api/admin/shop-backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
check('shop-backup exists+auth-gated', shopBk.status === 401 || shopBk.status === 403, String(shopBk.status))
const sysBk = await req('/api/super/system-backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
check('system-backup exists+auth-gated', sysBk.status === 401 || sysBk.status === 403, String(sysBk.status))
const shopRs = await req('/api/admin/shop-restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
check('shop-restore exists+auth-gated', shopRs.status === 401 || shopRs.status === 403, String(shopRs.status))
const sysRs = await req('/api/super/system-restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
check('system-restore exists+auth-gated', sysRs.status === 401 || sysRs.status === 403, String(sysRs.status))

// Tenant isolation surface: super APIs must refuse anonymous callers
const users = await req('/api/super/users')
check('super/users anonymous blocked', users.status === 401 || users.status === 403, String(users.status))
const stats = await req('/api/super/stats')
check('super/stats anonymous blocked', stats.status === 401 || stats.status === 403, String(stats.status))
const shops = await req('/api/super/shops')
check('super/shops anonymous blocked', shops.status === 401 || shops.status === 403, String(shops.status))

// Admin APIs anonymous blocked
const dash = await req('/api/admin/dashboard')
check('admin/dashboard anonymous blocked', dash.status === 401 || dash.status === 403, String(dash.status))
const admBk = await req('/api/admin/backup')
check('admin/backup (excel) anonymous blocked', admBk.status === 401 || admBk.status === 403, String(admBk.status))

// Setup endpoint: must report locked (owner account exists, not leak anything)
const setup = await (await req('/api/setup')).json().catch(() => null)
check('setup: locked (setupDone=true)', setup?.setupDone === true, JSON.stringify(setup))

console.log(`\nSUMMARY: ${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
