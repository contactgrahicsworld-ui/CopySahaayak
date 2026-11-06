// Rebuild /home/z/my-project/.env from Vercel decrypted values (per-ID endpoint)
// Usage: VCL_TOKEN=<vercel-token> node scripts/rebuild-env.mjs
// Token is never stored in this repo — pass it via the VCL_TOKEN env var.
import { writeFileSync, readFileSync } from 'fs'

const TOKEN = process.env.VCL_TOKEN || (readFileSync('/tmp/vcl-token', 'utf8').trim() || '')
if (!TOKEN) { console.error('set VCL_TOKEN env var (or /tmp/vcl-token file) first'); process.exit(1) }
const TEAM = 'team_kjzlL9oti3ciMWtCz2ye5IHy'
const PROJECT = 'prj_DvUIS0wkM6pqy0nrRJDLgyWLzDZw'

const list = await fetch(
  `https://api.vercel.com/v10/projects/${PROJECT}/env?teamId=${TEAM}`,
  { headers: { Authorization: `Bearer ${TOKEN}` } }
).then(r => r.json())

const lines = []
for (const e of list.envs || []) {
  const res = await fetch(
    `https://api.vercel.com/v1/projects/${PROJECT}/env/${e.id}?teamId=${TEAM}&decrypt=true`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  )
  const full = await res.json()
  const val = full.value
  if (val == null) { console.error('NO VALUE for', e.key, '- status', res.status); continue }
  lines.push(`${e.key}=${val.replace(/\n/g, '\\n')}`)
  console.log(e.key, '=> decrypted:', full.decrypted === true, '| len:', val.length)
}
writeFileSync('/home/z/my-project/.env', lines.join('\n') + '\n')
console.log('written .env with', lines.length, 'vars')
