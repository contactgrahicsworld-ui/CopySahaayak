// READ-ONLY diagnostic: how many app users / supers exist right now?
// Fresh-setup hypothesis: zero accounts => forgot-password can never send mail.
import fs from 'fs'
for (const line of fs.readFileSync('/home/z/my-project/.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
}
const { PrismaClient } = await import('@prisma/client')

const db = new PrismaClient()
try {
  const users = await db.user.findMany({
    select: { email: true, role: true, isActive: true, shopId: true },
  })
  console.log('TOTAL_USERS:', users.length)
  for (const u of users) {
    const [name, domain] = u.email.split('@')
    const masked = `${name.slice(0, 2)}***@${domain}`
    console.log(`  - ${masked} role=${u.role} active=${u.isActive} shopId=${u.shopId ? 'yes' : 'no'}`)
  }
  const supers = await db.user.count({ where: { role: 'SUPER' } })
  const otps = await db.passwordResetOtp.count()
  console.log('SUPER_COUNT:', supers)
  console.log('PASSWORD_RESET_OTP_ROWS:', otps)
} finally {
  await db.$disconnect()
}
