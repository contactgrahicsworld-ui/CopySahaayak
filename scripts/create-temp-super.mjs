// Create a TEMPORARY super admin for E2E testing on an already-bootstrapped
// deployment. Deleted afterwards by delete-temp-super.mjs. Never used for
// shipping credentials — the real first super admin is created via /setup.
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const EMAIL = process.env.TEMP_SUPER_EMAIL || `e2e-super.${crypto.randomBytes(3).toString('hex')}@testsuper-test.in`
const PASSWORD = `E2e!${crypto.randomBytes(9).toString('base64url')}#9`

const p = new PrismaClient()
try {
  const hash = await bcrypt.hash(PASSWORD, 10)
  const user = await p.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash: hash, isActive: true },
    create: {
      email: EMAIL,
      passwordHash: hash,
      name: 'E2E Temp Super',
      role: 'SUPER_ADMIN',
      isActive: true,
      shopId: null,
    },
  })
  // Output for the calling shell — consumed by tests/e2e-api.mjs via env vars.
  console.log(`TEMP_SUPER_EMAIL=${EMAIL}`)
  console.log(`TEMP_SUPER_PASSWORD=${PASSWORD}`)
} finally {
  await p.$disconnect()
}
