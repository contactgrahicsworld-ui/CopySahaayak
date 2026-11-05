import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn']
        : ['error', 'warn', 'query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Standard options for every interactive `db.$transaction(async (tx) => …)`.
 * The Prisma default (5 s timeout, 2 s maxWait) is too tight for serverless
 * (Vercel) talking to Supabase over the pooler: each statement round-trip costs
 * network latency, and a multi-statement transaction (order creation, shop
 * creation, shop offboard…) blows past 5 s and fails with P2028 — a user-facing
 * 500 that "sometimes works" locally. Every interactive transaction MUST use
 * these options so the failure cannot reappear on a slower region/day.
 */
export const TX = { maxWait: 15000, timeout: 60000 } as const