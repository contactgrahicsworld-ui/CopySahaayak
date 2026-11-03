// Diagnose Supabase integration using production env values (read-only checks).
import { readFileSync } from 'fs'

const envText = readFileSync('/tmp/vercel-env.txt', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const SB_URL = (get('SUPABASE_URL') || get('NEXT_PUBLIC_SUPABASE_URL')).replace(/\/+$/, '')
const ANON = get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const SERVICE = get('SUPABASE_SERVICE_ROLE_KEY')

console.log('SUPABASE_URL:', SB_URL ? SB_URL.replace(/https:\/\/([a-z0-9]{6})[^.]*/, 'https://$1***') : '(missing)')
console.log('ANON key:', ANON ? `present (${ANON.length} chars)` : '(missing)')
console.log('SERVICE key:', SERVICE ? `present (${SERVICE.length} chars)` : '(missing)')

async function check(name, path, key) {
  try {
    const res = await fetch(`${SB_URL}${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    console.log(`${name}: HTTP ${res.status}`, (await res.text()).slice(0, 120))
  } catch (e) {
    console.log(`${name}: FAILED — ${e.message}`)
  }
}

if (SB_URL && SERVICE) {
  await check('health       ', '/auth/v1/health', SERVICE)
  await check('admin users  ', '/auth/v1/admin/users?page=1&per_page=5', SERVICE)
}
if (SB_URL && ANON) {
  await check('anon settings', '/auth/v1/settings', ANON)
}
