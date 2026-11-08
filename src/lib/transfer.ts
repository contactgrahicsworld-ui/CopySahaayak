// Authority transfer (Power of Attorney) — shared engine for both scopes:
//   SHOP      → the shop owner hands the complete shop dashboard + payment UPI
//               authority to a new person
//   PLATFORM  → the super admin hands the complete platform authority to a new
//               person
// Flow: current authority confirms their OWN password → a single-use link valid
// for 24h is EMAILED to the new person (works like a forgot-password mail) → on
// acceptance the new person sets their own password and receives the complete
// authority in one transaction; the previous authority is deactivated and every
// one of their sessions is revoked. Nothing changes until the link is accepted.
import { db, TX } from '@/lib/db'
import { LIMITS } from '@/lib/constants'
import { randomToken, sha256, bcryptCompare, bcryptHash } from '@/lib/security'
import { mailTransport, sendMail, transferEmailTemplate } from '@/lib/mailer'
import { audit } from '@/lib/audit'
import { HttpError } from '@/lib/auth'

export type TransferScope = 'SHOP' | 'PLATFORM'

export function transferLinkBase(): string {
  return (
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'http://localhost:3000'
  )
}

export async function pendingTransfer(scope: TransferScope, key: { shopId?: string; fromUserId: string }) {
  return db.authorityTransfer.findFirst({
    where: {
      scope,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
      ...(scope === 'SHOP' ? { shopId: key.shopId } : { fromUserId: key.fromUserId }),
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, toName: true, toEmail: true, fromEmail: true, expiresAt: true, createdAt: true },
  })
}

/**
 * Initiates a transfer. Throws HttpError on any refusal.
 * @param confirmHash the initiator's current passwordHash from DB
 */
export async function initiateTransfer(opts: {
  scope: TransferScope
  shopId?: string
  shopName?: string | null
  fromUserId: string
  fromEmail: string
  fromName: string
  fromPasswordHash: string
  toName: string
  toEmail: string
  currentPassword: string
  ip?: string
}): Promise<{ sent: true; expiresAt: string }> {
  const toEmail = opts.toEmail.toLowerCase()
  if (toEmail === opts.fromEmail.toLowerCase()) {
    throw new HttpError(400, 'Choose a different email than your own — a transfer to yourself is not possible.')
  }
  if (mailTransport === 'none') {
    throw new HttpError(503, 'Email is not configured on this deployment, so the authority-transfer link cannot be delivered. Ask the platform admin to set up email (SMTP / RESEND_API_KEY) first.')
  }

  // The initiator's own password is the proof of authority — a stolen session
  // alone can never hand the platform/shop away.
  const pwOk = await bcryptCompare(opts.currentPassword, opts.fromPasswordHash)
  if (!pwOk) {
    await audit({
      shopId: opts.shopId,
      userId: opts.fromUserId,
      actorType: 'USER',
      action: 'AUTHORITY_TRANSFER_DENIED',
      entity: 'AuthorityTransfer',
      meta: { scope, reason: 'bad_password' },
      ip: opts.ip,
    })
    throw new HttpError(401, 'Password incorrect — transfer aborted')
  }

  // The new authority must be a NEW email (or an inactive, retired account).
  const existing = await db.user.findUnique({ where: { email: toEmail } })
  if (existing && existing.isActive) {
    throw new HttpError(409, 'This email already has an active CopySahaayak account. Use another email, or sign in with it instead.')
  }

  // One pending transfer per scope at a time — a newer request supersedes.
  await db.authorityTransfer.updateMany({
    where: {
      scope,
      status: 'PENDING',
      ...(opts.scope === 'SHOP' ? { shopId: opts.shopId } : { fromUserId: opts.fromUserId }),
    },
    data: { status: 'CANCELLED' },
  })

  const token = randomToken(32)
  const expiresAt = new Date(Date.now() + LIMITS.transferTtlMs)
  await db.authorityTransfer.create({
    data: {
      tokenHash: sha256(token),
      scope: opts.scope,
      shopId: opts.shopId ?? null,
      fromUserId: opts.fromUserId,
      fromEmail: opts.fromEmail,
      toEmail,
      toName: opts.toName,
      expiresAt,
      ip: opts.ip || null,
    },
  })

  const link = `${transferLinkBase()}/transfer/accept?token=${token}`
  const tpl = transferEmailTemplate({
    toName: opts.toName,
    fromName: opts.fromName,
    fromEmail: opts.fromEmail,
    scope: opts.scope,
    shopName: opts.shopName,
    link,
    expiresInHours: Math.round(LIMITS.transferTtlMs / 3600000),
  })
  try {
    await sendMail({ to: toEmail, ...tpl })
  } catch (err) {
    // Do not leave a dangling pending transfer if the mail physically failed.
    await db.authorityTransfer.updateMany({
      where: { tokenHash: sha256(token), status: 'PENDING' },
      data: { status: 'CANCELLED' },
    })
    throw new HttpError(502, `Transfer email could not be delivered (${err instanceof Error ? err.message.slice(0, 120) : 'mail error'}). No change was made — try again.`)
  }

  await audit({
    shopId: opts.shopId,
    userId: opts.fromUserId,
    actorType: 'USER',
    action: 'AUTHORITY_TRANSFER_INITIATED',
    entity: 'AuthorityTransfer',
    meta: { scope, toEmail, toName: opts.toName, expiresAt: expiresAt.toISOString() },
    ip: opts.ip,
  })
  return { sent: true, expiresAt: expiresAt.toISOString() }
}

export async function cancelPendingTransfer(opts: { scope: TransferScope; shopId?: string; fromUserId: string; userId: string; shopIdForAudit?: string | null; ip?: string }) {
  const res = await db.authorityTransfer.updateMany({
    where: {
      scope: opts.scope,
      status: 'PENDING',
      ...(opts.scope === 'SHOP' ? { shopId: opts.shopId } : { fromUserId: opts.fromUserId }),
    },
    data: { status: 'CANCELLED' },
  })
  if (res.count > 0) {
    await audit({
      shopId: opts.shopIdForAudit ?? opts.shopId ?? null,
      userId: opts.userId,
      actorType: 'USER',
      action: 'AUTHORITY_TRANSFER_CANCELLED',
      entity: 'AuthorityTransfer',
      meta: { scope: opts.scope },
      ip: opts.ip,
    })
  }
  return res.count
}

export interface TransferAcceptResult {
  scope: TransferScope
  shopId: string | null
  shopSlug: string | null
  userId: string
  redirect: string
}

/**
 * Accepts a valid, unexpired, single-use transfer token: the new person sets
 * their own password and instantly receives the complete authority; the old
 * authority is deactivated with every session revoked. Fully atomic.
 */
export async function acceptTransfer(token: string, password: string, name: string | undefined, ip?: string): Promise<TransferAcceptResult> {
  const tokenHash = sha256(token)
  const transfer = await db.authorityTransfer.findUnique({ where: { tokenHash }, include: { shop: true } })
  if (!transfer) throw new HttpError(404, 'This authority-transfer link is not valid.')
  if (transfer.status !== 'PENDING') throw new HttpError(410, `This transfer was already ${transfer.status.toLowerCase()}. Ask the current authority to send a new link.`)
  if (transfer.expiresAt < new Date()) {
    await db.authorityTransfer.updateMany({ where: { id: transfer.id, status: 'PENDING' }, data: { status: 'EXPIRED' } }).catch(() => {})
    throw new HttpError(410, 'This transfer link has expired. Ask the current authority to send a new link.')
  }

  // Hash BEFORE opening the transaction — bcrypt must not hold the DB
  // connection (same rule as shop registration).
  const hash = await bcryptHash(password)
  const result = await db.$transaction(async (tx) => {
    const finalName = name?.trim() || transfer.toName

    // 1. Retire the previous authority — credentials unusable, sessions dead.
    const fromUser = transfer.fromUserId
      ? await tx.user.findUnique({ where: { id: transfer.fromUserId } })
      : null
    if (fromUser && fromUser.isActive) {
      await tx.user.update({
        where: { id: fromUser.id },
        data: { isActive: false, passwordHash: sha256(randomToken(32)) }, // credential destroyed
      })
      await tx.session.updateMany({ where: { userId: fromUser.id, revokedAt: null }, data: { revokedAt: new Date() } })
    }

    // 2. Grant the new authority.
    const target = await tx.user.findUnique({ where: { email: transfer.toEmail } })
    let newUser
    if (target) {
      if (target.isActive) throw new HttpError(409, 'This email already has an active account — transfer aborted. No change was made.')
      newUser = await tx.user.update({
        where: { id: target.id },
        data: {
          isActive: true,
          passwordHash: hash,
          name: finalName,
          role: transfer.scope === 'PLATFORM' ? 'SUPER_ADMIN' : 'SHOP_ADMIN',
          shopId: transfer.scope === 'SHOP' ? transfer.shopId : null,
        },
      })
    } else {
      newUser = await tx.user.create({
        data: {
          email: transfer.toEmail,
          passwordHash: hash,
          name: finalName,
          role: transfer.scope === 'PLATFORM' ? 'SUPER_ADMIN' : 'SHOP_ADMIN',
          shopId: transfer.scope === 'SHOP' ? transfer.shopId : null,
          ...(transfer.scope === 'SHOP' && transfer.shopId
            ? { memberships: { create: { shopId: transfer.shopId, role: 'OWNER' } } }
            : {}),
        },
      })
    }

    // 3. PLATFORM scope: the platform must end with exactly ONE active super.
    if (transfer.scope === 'PLATFORM') {
      await tx.user.updateMany({
        where: { role: 'SUPER_ADMIN', isActive: true, id: { not: newUser.id } },
        data: { isActive: false },
      })
      await tx.session.updateMany({
        where: { user: { role: 'SUPER_ADMIN' }, revokedAt: null, userId: { not: newUser.id } },
        data: { revokedAt: new Date() },
      })
    }

    // 4. Consume the token.
    await tx.authorityTransfer.update({
      where: { id: transfer.id },
      data: { status: 'COMPLETED', acceptedAt: new Date(), newUserId: newUser.id },
    })
    return { newUser, shop: transfer.shop }
  }, TX)

  await audit({
    shopId: result.shop?.id ?? null,
    userId: result.newUser.id,
    actorType: 'USER',
    action: 'AUTHORITY_TRANSFER_ACCEPTED',
    entity: 'AuthorityTransfer',
    entityId: transfer.id,
    meta: { scope: transfer.scope, fromEmail: transfer.fromEmail, toEmail: transfer.toEmail },
    ip,
  })

  return {
    scope: transfer.scope,
    shopId: result.shop?.id ?? null,
    shopSlug: result.shop?.slug ?? null,
    userId: result.newUser.id,
    redirect: transfer.scope === 'PLATFORM' ? '/super' : '/admin',
  }
}
