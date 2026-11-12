// Remove the OLD super admin account TOTALLY (sessions cascade, audit/verified refs nulled).
// After this, POST /api/setup becomes available again for the FIRST-RUN super admin.
// Usage: node scripts/superadmin-swap.mjs <old-email>
import { readFileSync } from 'fs'
import pg from 'pg'

const OLD_EMAIL = (process.argv[2] || 'super@copysahaayak.app').toLowerCase()
const envText = readFileSync('/tmp/vercel-env.txt', 'utf8')
const get = (k) => {
  const m = envText.match(new RegExp(`^${k}="?(.*?)"?$`, 'm'))
  return m ? m[1] : ''
}
const url = get('DIRECT_URL') || get('DATABASE_URL')
if (!url) { console.error('No DIRECT_URL found'); process.exit(1) }

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
const q = (sql, p) => client.query(sql, p)

try {
  await q('BEGIN')

  const old = await q(
    `SELECT id, email, name, role, "isActive", "createdAt" FROM csp."User" WHERE lower(email)=$1`,
    [OLD_EMAIL]
  )
  if (old.rows.length === 0) {
    console.log('OLD SUPER NOT FOUND (already removed?):', OLD_EMAIL)
  } else {
    const u = old.rows[0]
    console.log('OLD SUPER:', JSON.stringify({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.isActive, created: u.createdAt }))

    // Safety: count active supers — must be exactly the one we intend to remove
    const supers = await q(`SELECT email FROM csp."User" WHERE role='SUPER_ADMIN' AND "isActive"=true`)
    console.log('ACTIVE SUPERS BEFORE:', supers.rows.map((r) => r.email).join(', ') || '(none)')
    if (supers.rows.length > 1) {
      console.error('ABORT: more than one active super admin exists — manual review needed')
      await q('ROLLBACK')
      process.exit(1)
    }

    const refs = await q(
      `SELECT
        (SELECT count(*)::int FROM csp."Session" WHERE "userId"=$1) AS sessions,
        (SELECT count(*)::int FROM csp."AuditLog" WHERE "userId"=$1) AS audit_logs,
        (SELECT count(*)::int FROM csp."Payment" WHERE "verifiedByUserId"=$1) AS payments_verified,
        (SELECT count(*)::int FROM csp."SubscriptionPayment" WHERE "verifiedByUserId"=$1) AS subpayments_verified,
        (SELECT count(*)::int FROM csp."ShopMember" WHERE "userId"=$1) AS memberships`,
      [u.id]
    )
    console.log('REFERENCES:', JSON.stringify(refs.rows[0]))

    // Null non-cascading references (historical records stay, link removed)
    await q(`UPDATE csp."Payment" SET "verifiedByUserId"=NULL WHERE "verifiedByUserId"=$1`, [u.id])
    await q(`UPDATE csp."SubscriptionPayment" SET "verifiedByUserId"=NULL WHERE "verifiedByUserId"=$1`, [u.id])
    await q(`UPDATE csp."AuditLog" SET "userId"=NULL, "actorId"=NULL WHERE "userId"=$1`, [u.id])
    await q(`DELETE FROM csp."ShopMember" WHERE "userId"=$1`, [u.id])
    await q(`DELETE FROM csp."Session" WHERE "userId"=$1`, [u.id])
    const del = await q(`DELETE FROM csp."User" WHERE id=$1`, [u.id])
    console.log('DELETED USER ROWS:', del.rowCount)
  }

  const after = await q(`SELECT email FROM csp."User" WHERE role='SUPER_ADMIN'`)
  const orphanSessions = await q(
    `SELECT count(*)::int AS n FROM csp."Session" WHERE "userId" NOT IN (SELECT id FROM csp."User")`
  )
  console.log('SUPERS AFTER DELETE:', after.rows.map((r) => r.email).join(', ') || '(none — setup endpoint is now OPEN)')
  console.log('ORPHAN SESSIONS:', orphanSessions.rows[0].n)

  await q('COMMIT')
  console.log('SWAP-PHASE-1 DONE: old super admin removed totally')
} catch (e) {
  await q('ROLLBACK')
  console.error('FAILED, rolled back:', e.message)
  process.exit(1)
} finally {
  await client.end()
}
