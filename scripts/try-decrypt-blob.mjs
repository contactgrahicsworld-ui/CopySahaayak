// Try to decrypt Vercel v2 env blobs (format: {"v":"v2","c":<b64>,"k":<b64?>})
// Known plaintext: DATABASE_URL starts with "postgresql://postgres."
import { readFileSync } from 'fs'
import { createDecipheriv } from 'crypto'

const raw = JSON.parse(readFileSync('/tmp/vercel-env.json', 'utf8'))
const entry = raw.envs.find((e) => e.key === 'DATABASE_URL')
const meta = JSON.parse(Buffer.from(entry.value, 'base64').toString('utf8'))
const c = Buffer.from(meta.c, 'base64')
console.log('c bytes:', c.length, '| k type:', typeof meta.k, '| k:', typeof meta.k === 'string' ? meta.k.slice(0, 24) + '...' : meta.k)

let keyBuf = null
if (typeof meta.k === 'string') {
  try { keyBuf = Buffer.from(meta.k, 'base64'); } catch {}
  if (!keyBuf || keyBuf.length !== 32) keyBuf = Buffer.from(meta.k.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  console.log('k decoded bytes:', keyBuf?.length)
}
if (!keyBuf || keyBuf.length !== 32) { console.log('k is not a 32-byte key — abort'); process.exit(1) }

const target = 'postgres'
function tryGcm(label, iv, data, tag, aad) {
  try {
    const d = createDecipheriv('aes-256-gcm', keyBuf, iv, { authTagLength: 16 })
    if (aad) d.setAAD(aad)
    d.setAuthTag(tag)
    const out = Buffer.concat([d.update(data), d.final()])
    console.log(label, 'SUCCESS:', out.slice(0, 40).toString())
    return true
  } catch { return false }
}

let ok = false
for (const ivLen of [12, 16]) {
  if (c.length > ivLen + 16) {
    ok = tryGcm(`gcm iv${ivLen} tail-tag`, c.subarray(0, ivLen), c.subarray(ivLen, c.length - 16), c.subarray(c.length - 16)) || ok
    ok = tryGcm(`gcm iv${ivLen} head-tag`, c.subarray(0, ivLen), c.subarray(ivLen + 16), c.subarray(ivLen, ivLen + 16)) || ok
  }
}
if (!ok) {
  // maybe iv is all zeros / or aad = project id
  const iv0 = Buffer.alloc(12)
  ok = tryGcm('gcm iv0 tail-tag', iv0, c.subarray(0, c.length - 16), c.subarray(c.length - 16)) || ok
}
if (!ok) console.log('ALL GCM VARIANTS FAILED — blobs are KMS-encrypted, not locally decryptable')
