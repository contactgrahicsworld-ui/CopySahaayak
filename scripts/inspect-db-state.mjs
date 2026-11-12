import { PrismaClient } from '@prisma/client'
import fs from 'fs'
const line = fs.readFileSync('/tmp/dburl.txt', 'utf8').trim()
const url = line.slice(line.indexOf('=') + 1).trim().replace(/^"|"$/g, '')
const db = new PrismaClient({ datasources: { db: { url } } })
const users = await db.user.findMany({
  select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true, updatedAt: true, shopId: true },
  orderBy: { createdAt: 'desc' },
  take: 20,
})
console.log('=== USERS (latest 20) ===')
for (const u of users) console.log(`${u.createdAt.toISOString()} | ${u.role} | active=${u.isActive} | ${u.email} | ${u.name} | shop=${u.shopId || '-'} | id=${u.id}`)
const logs = await db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 15, select: { createdAt: true, action: true, actorEmail: true, meta: true } }).catch(() => [])
console.log('=== AUDITLOG (latest 15) ===')
for (const l of logs) console.log(`${l.createdAt.toISOString()} | ${l.action} | actor=${l.actorEmail} | ${JSON.stringify(l.meta).slice(0, 120)}`)
await db.$disconnect()
