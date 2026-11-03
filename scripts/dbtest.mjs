import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
try {
  const r = await p.$queryRaw`SELECT count(*)::int as users FROM "User"`
  console.log('DB OK:', JSON.stringify(r))
  process.exit(0)
} catch (e) {
  console.log('DB ERR:', e.message.slice(0, 300))
  process.exit(1)
} finally {
  await p.$disconnect()
}
