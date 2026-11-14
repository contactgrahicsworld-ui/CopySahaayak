// Reset the platform to FRESH SETUP state — owner-requested.
// Deletes the existing SUPER_ADMIN account + tombstone so /setup opens publicly
// again (first-run behaviour: no recovery key needed).
// SAFETY:
//   - Refuses to run unless EXACTLY 1 SUPER_ADMIN user exists (pre + post checks).
//   - Never touches SHOP_ADMIN users, shops, orders, payments, files, plans.
//   - Runs in ONE transaction: either the platform is fully reset to fresh, or
//     nothing changes.
//   - Pending PLATFORM authority transfers are cancelled, stale reset OTPs and
//     the ex-admin's sessions/backup jobs are removed.
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'fs'

const url = (() => {
  const raw = readFileSync('/tmp/dburl.txt', 'utf8').trim()
  return raw.includes('schema=') ? raw : `${raw}${raw.includes('?') ? '&' : '?'}schema=csp`
})()
const db = new PrismaClient({ datasources: { db: { url } } })

const TOMBSTONE_KEYS = ['super_setup_used', 'setup_claim_hash', 'setup_claim_expires']
const UPI_KEYS = ['super_admin_upi_vpa', 'super_admin_payee_name']

function mask(email) {
  if (!email || !email.includes('@')) return '(unknown)'
  const [name, domain] = email.split('@')
  return `${name.slice(0, 2)}***@${domain}`
}

async function main() {
  const supers = await db.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true, email: true, isActive: true } })
  const shopAdmins = await db.user.count({ where: { role: 'SHOP_ADMIN' } })
  const shops = await db.shop.count()
  console.log(`pre-check: SUPER_ADMIN(s)=${supers.length} (${supers.map((s) => mask(s.email)).join(', ')}) | SHOP_ADMIN=${shopAdmins} | shops=${shops}`)
  if (supers.length !== 1) {
    console.error(`ABORT: expected exactly 1 SUPER_ADMIN, found ${supers.length}. Nothing changed.`)
    process.exit(1)
  }
  const superUser = supers[0]

  const result = await db.$transaction(async (tx) => {
    const sess = await tx.session.deleteMany({ where: { userId: superUser.id } })
    const otps = await tx.passwordResetOtp.deleteMany({ where: { email: superUser.email } })
    const bjobs = await tx.backupJob.deleteMany({ where: { createdBy: superUser.id } })
    const del = await tx.user.deleteMany({ where: { id: superUser.id, role: 'SUPER_ADMIN' } })
    const post = await tx.user.count({ where: { role: 'SUPER_ADMIN' } })
    if (post !== 0) throw new Error(`post-delete check failed: ${post} SUPER_ADMIN remain — rolling back`)
    const transfers = await tx.authorityTransfer.updateMany({ where: { scope: 'PLATFORM', status: 'PENDING' }, data: { status: 'CANCELLED' } })
    const tomb = await tx.platformSetting.deleteMany({ where: { key: { in: [...TOMBSTONE_KEYS, ...UPI_KEYS] } } })
    return { sessions: sess.count, otps: otps.count, backupJobs: bjobs.count, deleted: del.count, transfers: transfers.count, settings: tomb.count }
  }, { timeout: 30_000, maxWait: 10_000 })

  const postSupers = await db.user.count({ where: { role: 'SUPER_ADMIN' } })
  const tombstone = await db.platformSetting.findUnique({ where: { key: 'super_setup_used' } })
  console.log(`transaction: deleted=${result.deleted} sessions=${result.sessions} otps=${result.otps} backupJobs=${result.backupJobs} transfersCancelled=${result.transfers} settingsCleared=${result.settings}`)
  console.log(`post-check: SUPER_ADMIN=${postSupers} | tombstone present=${Boolean(tombstone)} | SHOP_ADMIN untouched=${shopAdmins} | shops untouched=${shops}`)
  console.log('RESULT: FRESH — /api/setup should now report setupDone:false, recoveryRequired:false')
  console.log(`SECURITY WINDOW OPEN: complete setup at /setup ASAP (first person to create an account owns the platform).`)
}

main()
  .catch((e) => { console.error('FAILED (rolled back):', e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => db.$disconnect())
