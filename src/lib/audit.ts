// Audit logging — append-only trail for security-relevant actions.
import { db } from '@/lib/db'

export type ActorType = 'USER' | 'DEVICE' | 'CUSTOMER' | 'SYSTEM'

export async function audit(entry: {
  shopId?: string | null
  userId?: string | null
  actorType: ActorType
  actorId?: string | null
  action: string
  entity?: string
  entityId?: string
  meta?: Record<string, unknown>
  ip?: string
}) {
  try {
    await db.auditLog.create({
      data: {
        shopId: entry.shopId || null,
        userId: entry.userId || null,
        actorType: entry.actorType,
        actorId: entry.actorId || null,
        action: entry.action,
        entity: entry.entity || null,
        entityId: entry.entityId || null,
        metaJson: entry.meta ? JSON.stringify(entry.meta).slice(0, 2000) : null,
        ip: entry.ip || null,
      },
    })
  } catch {
    // Never let audit failures break the main flow; log server-side
    console.error('[audit] failed to record', entry.action)
  }
}
