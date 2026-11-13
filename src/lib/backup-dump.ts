// Full-fidelity backup / restore for CopySahaayak.
//
// TENANT ISOLATION RULES (owner requirement):
//   - SYSTEM scope: super admin only. Dumps the whole platform (all shops,
//     all tables incl. files as base64). Restoring wipes + rebuilds the DB.
//   - SHOP scope: shop admin only, pinned to their OWN shop. Dumps ONLY that
//     shop's business data (profile, pricing, printers, devices, orders,
//     items, payments, files, notifications). It NEVER includes users /
//     sessions / subscription billing rows — logins and platform billing stay
//     under the platform admin's control, so a restore can never overwrite
//     someone's password or grant a plan.
//   - A shop restore validates that the dump belongs to the SAME shop.
//
// Wire format: JSON → gzip → base64 → ~1.5MB text chunks (Vercel serverless
// request/response body caps make single-shot transfer impossible once files
// are included). Restores accept gzip magic (0x1f8b) or plain JSON.
import { db, retryDb } from '@/lib/db'
import { timingSafeEqualStr } from '@/lib/security'

export const DUMP_VERSION = 3
const CHUNK_RAW_BYTES = 1_400_000 // base64 payload budget per chunk (<4.5MB body cap)
export const MAX_BACKUP_BYTES = 400 * 1024 * 1024 // 400MB decompressed sanity cap

type Row = Record<string, unknown>

export type Dump = {
  format: 'copysahaayak-backup'
  version: number
  scope: 'SYSTEM' | 'SHOP'
  createdAt: string
  header: {
    shopId?: string
    shopSlug?: string
    shopName?: string
    platformShops?: number
  }
  tables: Record<string, Row[]>
}

// ---------- dump building ----------
// FK-safe parent→child order for createMany during restore.
const SYSTEM_TABLES = [
  'PlatformSetting', 'Plan', 'User', 'Shop', 'ShopMember', 'Subscription',
  'SubscriptionPayment', 'PricingRule', 'CustomerSession', 'StoredObject',
  'Document', 'Order', 'OrderItem', 'Payment', 'PaymentVerification',
  'Device', 'Printer', 'RoutingRule', 'PrintJob', 'PrintEvent',
  'WeeklyReport', 'AuditLog', 'Notification',
] as const

// Child→parent order for deleteMany (shop scope keeps Shop row itself).
const SHOP_TABLES = [
  'RoutingRule', 'PrintEvent', 'PrintJob', 'Printer', 'Device',
  'PaymentVerification', 'Payment', 'OrderItem', 'Order', 'Document',
  'StoredObject', 'CustomerSession', 'PricingRule', 'Notification', 'WeeklyReport',
] as const

// Children of Shop deleted before updating the Shop row itself (SYSTEM wipe).
const SYSTEM_DELETE_ORDER = [
  'PaymentVerification', 'PrintEvent', 'PrintJob', 'RoutingRule', 'Printer',
  'Device', 'Payment', 'OrderItem', 'Order', 'Document', 'StoredObject',
  'CustomerSession', 'Notification', 'WeeklyReport', 'AuditLog',
  'SubscriptionPayment', 'Subscription', 'PricingRule', 'ShopMember',
  'Session', 'AuthorityTransfer', 'PasswordResetOtp', 'RateLimitEntry',
  'BackupChunk', 'BackupJob', 'User', 'Shop', 'Plan', 'PlatformSetting',
] as const

function b64(buf: Buffer): string {
  return buf.toString('base64')
}

export async function buildSystemDump(): Promise<Dump> {
  const [settings, plans, users, shops, members, subs, subPayments, pricing, csessions, stored, documents, orders, items, payments, verifs, devices, printers, routing, pjobs, pevents, weekly, audit, notifications] =
    await Promise.all([
      retryDb(() => db.platformSetting.findMany()),
      retryDb(() => db.plan.findMany()),
      retryDb(() => db.user.findMany()),
      retryDb(() => db.shop.findMany()),
      retryDb(() => db.shopMember.findMany()),
      retryDb(() => db.subscription.findMany()),
      retryDb(() => db.subscriptionPayment.findMany()),
      retryDb(() => db.pricingRule.findMany()),
      retryDb(() => db.customerSession.findMany()),
      retryDb(() => db.storedObject.findMany()),
      retryDb(() => db.document.findMany()),
      retryDb(() => db.order.findMany()),
      retryDb(() => db.orderItem.findMany()),
      retryDb(() => db.payment.findMany()),
      retryDb(() => db.paymentVerification.findMany()),
      retryDb(() => db.device.findMany()),
      retryDb(() => db.printer.findMany()),
      retryDb(() => db.routingRule.findMany()),
      retryDb(() => db.printJob.findMany()),
      retryDb(() => db.printEvent.findMany()),
      retryDb(() => db.weeklyReport.findMany()),
      retryDb(() => db.auditLog.findMany()),
      retryDb(() => db.notification.findMany()),
    ])
  const tables: Record<string, Row[]> = {
    PlatformSetting: settings as unknown as Row[],
    Plan: plans as unknown as Row[],
    User: users as unknown as Row[],
    Shop: shops as unknown as Row[],
    ShopMember: members as unknown as Row[],
    Subscription: subs as unknown as Row[],
    SubscriptionPayment: subPayments as unknown as Row[],
    PricingRule: pricing as unknown as Row[],
    CustomerSession: csessions as unknown as Row[],
    StoredObject: stored.map((o) => ({ ...o, bytes: b64(Buffer.from(o.bytes)) })) as unknown as Row[],
    Document: documents as unknown as Row[],
    Order: orders as unknown as Row[],
    OrderItem: items as unknown as Row[],
    Payment: payments as unknown as Row[],
    PaymentVerification: verifs as unknown as Row[],
    Device: devices as unknown as Row[],
    Printer: printers as unknown as Row[],
    RoutingRule: routing as unknown as Row[],
    PrintJob: pjobs as unknown as Row[],
    PrintEvent: pevents as unknown as Row[],
    WeeklyReport: weekly as unknown as Row[],
    AuditLog: audit as unknown as Row[],
    Notification: notifications as unknown as Row[],
  }
  return {
    format: 'copysahaayak-backup',
    version: DUMP_VERSION,
    scope: 'SYSTEM',
    createdAt: new Date().toISOString(),
    header: { platformShops: shops.length },
    tables,
  }
}

export async function buildShopDump(shopId: string): Promise<Dump> {
  const shop = await retryDb(() => db.shop.findUnique({ where: { id: shopId } }))
  if (!shop) throw new Error('Shop not found')
  const docsForKeys = await retryDb(() => db.document.findMany({ where: { shopId }, select: { storedPath: true } }))
  const logoRow = await retryDb(() => db.shop.findUnique({ where: { id: shopId }, select: { logoPath: true } }))
  const storageKeys = [...new Set([...docsForKeys.map((d) => d.storedPath), logoRow?.logoPath].filter(Boolean))] as string[]
  const [pricing, csessions, storedObjects, documents, orders, items, payments, verifs, devices, printers, routing, pjobs, pevents, notifications, weekly] =
    await Promise.all([
      retryDb(() => db.pricingRule.findMany({ where: { shopId } })),
      retryDb(() => db.customerSession.findMany({ where: { shopId } })),
      // StoredObject has no shopId — join through Document.storedPath + shop logo.
      retryDb(() => db.storedObject.findMany({ where: { key: { in: storageKeys } } })),
      retryDb(() => db.document.findMany({ where: { shopId } })),
      retryDb(() => db.order.findMany({ where: { shopId } })),
      retryDb(() => db.orderItem.findMany({ where: { shopId } })),
      retryDb(() => db.payment.findMany({ where: { shopId } })),
      retryDb(() => db.paymentVerification.findMany({ where: { payment: { shopId } } })),
      retryDb(() => db.device.findMany({ where: { shopId } })),
      retryDb(() => db.printer.findMany({ where: { shopId } })),
      retryDb(() => db.routingRule.findMany({ where: { shopId } })),
      retryDb(() => db.printJob.findMany({ where: { shopId } })),
      retryDb(() => db.printEvent.findMany({ where: { shopId } })),
      retryDb(() => db.notification.findMany({ where: { shopId } })),
      retryDb(() => db.weeklyReport.findMany({ where: { shopId } })),
    ])
  const tables: Record<string, Row[]> = {
    Shop: [{ ...shop } as unknown as Row],
    PricingRule: pricing as unknown as Row[],
    CustomerSession: csessions as unknown as Row[],
    StoredObject: storedObjects.map((o) => ({ ...o, bytes: b64(Buffer.from(o.bytes)) })) as unknown as Row[],
    Document: documents as unknown as Row[],
    Order: orders as unknown as Row[],
    OrderItem: items as unknown as Row[],
    Payment: payments as unknown as Row[],
    PaymentVerification: verifs as unknown as Row[],
    Device: devices as unknown as Row[],
    Printer: printers as unknown as Row[],
    RoutingRule: routing as unknown as Row[],
    PrintJob: pjobs as unknown as Row[],
    PrintEvent: pevents as unknown as Row[],
    Notification: notifications as unknown as Row[],
    WeeklyReport: weekly as unknown as Row[],
  }
  return {
    format: 'copysahaayak-backup',
    version: DUMP_VERSION,
    scope: 'SHOP',
    createdAt: new Date().toISOString(),
    header: { shopId: shop.id, shopSlug: shop.slug, shopName: shop.name },
    tables,
  }
}

// ---------- dump validation ----------
export function validateDump(dump: unknown, expectedScope: 'SYSTEM' | 'SHOP', opts: { ownShopId?: string } = {}): asserts dump is Dump {
  const d = dump as Partial<Dump>
  if (!d || typeof d !== 'object') throw new Error('Backup file is not valid JSON')
  if (d.format !== 'copysahaayak-backup') throw new Error('Ye CopySahaayak backup file nahi hai (format header missing)')
  if (d.scope !== expectedScope) {
    throw new Error(`Scope mismatch: ye file "${d.scope}" scope ki hai, restore "${expectedScope}" scope se hoga`)
  }
  if (typeof d.version !== 'number' || d.version > DUMP_VERSION) {
    throw new Error(`Backup version ${d.version} is newer than this platform (${DUMP_VERSION}). Platform update karein.`)
  }
  if (!d.tables || typeof d.tables !== 'object') throw new Error('Backup tables missing')
  if (expectedScope === 'SHOP') {
    if (!d.header?.shopId) throw new Error('Backup header missing shopId')
    if (opts.ownShopId && d.header.shopId !== opts.ownShopId) {
      throw new Error('Ye backup kisi DOOSRI shop ka hai — apni hi shop ka backup restore kar sakte hain (tenant isolation)')
    }
  }
  const required = expectedScope === 'SYSTEM' ? ['Shop', 'User'] : ['Shop', 'Order']
  for (const t of required) {
    if (!Array.isArray(d.tables[t])) throw new Error(`Backup table "${t}" missing/corrupt`)
  }
}

// ---------- restore ----------
function reviveBytes(rows: Row[]): Row[] {
  return rows.map((r) => {
    if (typeof r.bytes === 'string') return { ...r, bytes: Buffer.from(r.bytes, 'base64') }
    return r
  })
}

export async function restoreSystemDump(dump: Dump): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  await db.$transaction(async (tx) => {
    // Wipe everything (children first). Runtime sessions die with it — the
    // restoring admin re-logs in, which is expected after a system restore.
    for (const t of SYSTEM_DELETE_ORDER) {
      await tx[t].deleteMany()
    }
    for (const t of SYSTEM_TABLES) {
      const rows = reviveBytes((dump.tables[t] || []) as Row[])
      if (rows.length) {
        await tx[t].createMany({ data: rows as never })
      }
      counts[t] = rows.length
    }
  }, { timeout: 60_000, maxWait: 20_000 })
  return counts
}

export async function restoreShopDump(shopId: string, dump: Dump): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  const shopProfile = (dump.tables.Shop || [])[0] as { name?: string; ownerName?: string; phone?: string; whatsappNumber?: string; address?: string; upiVpa?: string; upiPayeeName?: string; logoPath?: string } | undefined
  // Keys currently owned by this shop: its documents' stored paths + shop logo.
  const docs = await retryDb(() => db.document.findMany({ where: { shopId }, select: { storedPath: true } }))
  const shop = await retryDb(() => db.shop.findUnique({ where: { id: shopId }, select: { logoPath: true } }))
  const ownedKeys = [...new Set([...docs.map((d) => d.storedPath), shop?.logoPath].filter(Boolean))] as string[]
  await db.$transaction(async (tx) => {
    // Business data only — users, sessions, subscription billing untouched.
    for (const t of SHOP_TABLES) {
      if (t === 'StoredObject') {
        // StoredObject has no shopId column — delete exactly the keys this
        // shop owns (uploads/{shopId}/... + branding logo), never others'.
        if (ownedKeys.length) {
          await tx.storedObject.deleteMany({ where: { key: { in: ownedKeys } } })
        }
      } else {
        await tx[t].deleteMany({ where: { shopId } })
      }
    }
    if (shopProfile) {
      await tx.shop.update({
        where: { id: shopId },
        data: {
          name: shopProfile.name || undefined,
          ownerName: shopProfile.ownerName ?? undefined,
          phone: shopProfile.phone ?? undefined,
          whatsappNumber: shopProfile.whatsappNumber ?? undefined,
          address: shopProfile.address ?? undefined,
          upiVpa: shopProfile.upiVpa ?? undefined,
          upiPayeeName: shopProfile.upiPayeeName ?? undefined,
          logoPath: shopProfile.logoPath ?? undefined,
        },
      })
    }
    const TABLES: readonly string[] = ['PricingRule', 'CustomerSession', 'StoredObject', 'Document', 'Order', 'OrderItem', 'Payment', 'PaymentVerification', 'Device', 'Printer', 'RoutingRule', 'PrintJob', 'PrintEvent', 'Notification', 'WeeklyReport']
    for (const t of TABLES) {
      const rows = reviveBytes((dump.tables[t] || []) as Row[])
      if (rows.length) {
        await tx[t].createMany({ data: rows as never })
      }
      counts[t] = rows.length
    }
  }, { timeout: 60_000, maxWait: 20_000 })
  return counts
}

// ---------- gzip + chunk helpers ----------
export function chunkPayload(gzBase64: string): string[] {
  const chunks: string[] = []
  for (let i = 0; i < gzBase64.length; i += CHUNK_RAW_BYTES) chunks.push(gzBase64.slice(i, i + CHUNK_RAW_BYTES))
  return chunks
}

export function isGzip(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

// Serverless memory guard: read the gzip ISIZE trailer (last 4 bytes, little
// endian = decompressed size mod 2^32) BEFORE gunzipSync allocates the output.
// Prevents a hostile or oversized backup file from OOM-killing the function.
export const MAX_DECOMPRESSED_BYTES = 900 * 1024 * 1024 // 900MB decoded ceiling
export function gzipDecompressedSize(buf: Buffer): number {
  if (!isGzip(buf) || buf.length < 18) return buf.length // plain JSON
  return buf.readUInt32LE(buf.length - 4)
}

export { timingSafeEqualStr }
