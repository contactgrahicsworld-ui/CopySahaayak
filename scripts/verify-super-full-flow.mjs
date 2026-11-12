// LIVE end-to-end verification of the super-admin credential + forgot-password flows.
// Uses a disposable mail.tm inbox so the real Supabase free-tier OTP email is captured.
// Cleanup at the end removes the temp super admin + mirror auth user.
// Usage: node scripts/verify-super-full-flow.mjs <base_url>
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

// ---------- mail.tm disposable inbox ----------
const MAIL_PASS = 'Tm' + Math.random().toString(36).slice(2, 12) + '!9'
async function createInbox() {
  const domRes = await fetch('https://api.mail.tm/domains?page=1')
  const domJson = await domRes.json()
  const domain = domJson['hydra:member']?.[0]?.domain
  if (!domain) throw new Error('mail.tm: no domain')
  const local = 'cpsuper' + Math.random().toString(36).slice(2, 10)
  const address = `${local}@${domain}`
  const acc = await fetch('https://api.mail.tm/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password: MAIL_PASS }) })
  if (acc.status !== 201) throw new Error(`mail.tm account create failed: ${acc.status} ${await acc.text()}`)
  const tok = await fetch('https://api.mail.tm/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address, password: MAIL_PASS }) })
  const tokJson = await tok.json()
  if (!tokJson.token) throw new Error('mail.tm token failed')
  return { address, token: tokJson.token, id: tokJson.id }
}
async function pollInbox(mailToken, minutes = 3) {
  const deadline = Date.now() + minutes * 60 * 1000
  while (Date.now() < deadline) {
    const res = await fetch('https://api.mail.tm/messages?page=1', { headers: { Authorization: `Bearer ${mailToken}` } })
    const j = await res.json()
    const msgs = j['hydra:member'] || []
    if (msgs.length > 0) {
      const full = await (await fetch(`https://api.mail.tm/messages/${msgs[0].id}`, { headers: { Authorization: `Bearer ${mailToken}` } })).json()
      return full
    }
    await new Promise((r) => setTimeout(r, 6000))
  }
  return null
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
let inbox
try { inbox = await createInbox() } catch (e) { console.error('inbox creation failed:', e.message); process.exit(1) }
const EMAIL = inbox.address
const PASS1 = 'TestPass1x'
const PASS2 = 'FreshPass2y'
const NAME = 'Test Owner'
const PHONE = '98765 43210'
console.log(`Temp inbox: ${EMAIL}\n`)

// 1. Setup with FULL form + recovery key
const setup = await api('/api/setup', { method: 'POST', body: { name: NAME, email: EMAIL, phone: PHONE, password: PASS1, resetKey: RESET_KEY } })
check('POST /api/setup (recovery + full form)', setup.status === 200, `status=${setup.status} ${JSON.stringify(setup.json)}`)

// 2. Login with created credentials
const login1 = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASS1 } })
const ck1 = cookieFrom(login1.res)
check('login with created credentials', login1.status === 200 && !!ck1, `status=${login1.status}`)

// 3. Name stored on auth/me; WhatsApp visible via the Users directory API
const me = await api('/api/auth/me', {}, ck1)
check('auth/me: role SUPER_ADMIN + name saved', me.status === 200 && me.json?.user?.role === 'SUPER_ADMIN' && me.json?.user?.name === NAME, JSON.stringify({ role: me.json?.user?.role, name: me.json?.user?.name }))
const dir = await api('/api/super/users', {}, ck1)
const selfRow = (dir.json?.users || []).find((u) => u.email === EMAIL)
check('WhatsApp number saved (Users directory)', !!selfRow && (selfRow.phone || '').replace(/\D/g, '') === '9876543210', JSON.stringify({ phone: selfRow?.phone, name: selfRow?.name }))

// 4. Forgot password → 6-digit email via Supabase free tier
const forgot = await api('/api/auth/forgot', { method: 'POST', body: { email: EMAIL } })
check('POST /api/auth/forgot → sent', forgot.status === 200 && forgot.json?.sent === true, `status=${forgot.status} ${JSON.stringify(forgot.json)}`)

// 5. Read the real email, extract the code
const mail = await pollInbox(inbox.token, 3)
if (!mail) {
  check('Supabase OTP email received in inbox', false, 'no message within 3 min')
} else {
  const bodyText = `${mail.text || ''}\n${(mail.html || []).join('') || mail.html || ''}`
  const visible = bodyText.match(/\b(\d{6})\b/)
  const inLink = bodyText.match(/token=(\d{6})/)
  const code = visible ? visible[1] : inLink ? inLink[1] : null
  check('Supabase OTP email received', true, `subject="${mail.subject}" from="${mail.from?.address}"`)
  check('email contains a 6-digit code', !!code, code ? `code=${code}` : 'no 6-digit token found')

  // 6. Reset with the code
  if (code) {
    const reset = await api('/api/auth/reset', { method: 'POST', body: { email: EMAIL, code, password: PASS2 } })
    check('POST /api/auth/reset with emailed code', reset.status === 200, `status=${reset.status} ${JSON.stringify(reset.json)}`)

    // 7. Old password dead, new password works
    const oldLogin = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASS1 } })
    check('OLD password rejected after reset', oldLogin.status === 401, `status=${oldLogin.status}`)
    const newLogin = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASS2 } })
    const ck2 = cookieFrom(newLogin.res)
    check('NEW password login works', newLogin.status === 200 && !!ck2, `status=${newLogin.status}`)

    // 8. Wrong code rejected
    const badCode = await api('/api/auth/reset', { method: 'POST', body: { email: EMAIL, code: '000000', password: 'Zz987654' } })
    check('wrong 6-digit code rejected', badCode.status === 400, `status=${badCode.status}`)

    // 9. Cleanup: self-delete via the Users-tab DELETE API (password-confirmed)
    const meId = (await api('/api/auth/me', {}, ck2)).json?.user?.id
    const del = await api('/api/super/users', { method: 'DELETE', body: { userId: meId, password: PASS2 } }, ck2)
    check('DELETE /api/super/users (self, password-confirmed)', del.status === 200 && del.json?.setupReopened === true, `status=${del.status} ${JSON.stringify(del.json)}`)
    const sessionDead = await api('/api/auth/me', {}, ck2)
    check('session destroyed after delete', sessionDead.json?.user == null, `status=${sessionDead.status}`)
  }
}

// 10. Mirror + platform state cleanup/verification
const mirror = await sbFindMirror(EMAIL)
if (mirror) check('Supabase mirror user cleaned up', sbDeleteMirror(mirror.id), `id=${mirror.id}`)
else check('Supabase mirror user cleaned up', true, 'not found (already absent)')

const finalState = await api('/api/setup')
check('platform back to self-create state', finalState.json?.setupDone === false && finalState.json?.recoveryRequired === true, JSON.stringify(finalState.json))

const failed = results.filter((r) => !r.ok)
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`)
process.exit(failed.length ? 1 : 0)
