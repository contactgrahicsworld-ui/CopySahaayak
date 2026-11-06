// Restore production env from Vercel (decrypted) into /tmp/vercel-env.txt
// Usage: VCL_TOKEN=<vercel-token> node scripts/fetch-vercel-env.mjs
// Token is never stored in this repo — pass it via the VCL_TOKEN env var.
import { writeFileSync } from 'fs'

const TOKEN = process.env.VCL_TOKEN
if (!TOKEN) { console.error('set VCL_TOKEN env var first'); process.exit(1) }
const TEAM = 'team_kjzlL9oti3ciMWtCz2ye5IHy'
const PROJECT = 'prj_DvUIS0wkM6pqy0nrRJDLgyWLzDZw'

const res = await fetch(
  `https://api.vercel.com/v10/projects/${PROJECT}/env?decrypt=true&teamId=${TEAM}`,
  { headers: { Authorization: `Bearer ${TOKEN}` } }
)
if (!res.ok) {
  console.error('Vercel env fetch failed:', res.status, (await res.text()).slice(0, 200))
  process.exit(1)
}
const data = await res.json()
const lines = []
for (const e of data.envs || []) {
  if (e.value == null) continue
  lines.push(`${e.key}=${e.value.replace(/\n/g, '\\n')}`)
}
writeFileSync('/tmp/vercel-env.txt', lines.join('\n') + '\n')
const keys = (data.envs || []).map((e) => e.key)
console.log('env vars fetched:', keys.length)
console.log('has DATABASE_URL:', keys.includes('DATABASE_URL'), '| has DIRECT_URL:', keys.includes('DIRECT_URL'), '| has APP_SECRET:', keys.includes('APP_SECRET'))
