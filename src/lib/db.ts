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

/**
 * Self-recovery for transient infrastructure errors: a pooler blip, a cold
 * connection, a lock timeout. These fail once and succeed on retry — so instead
 * of surfacing a random 500 to the shop, hot paths retry a few times with a
 * short backoff. Non-transient errors are rethrown untouched.
 */
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1017', 'P2024', 'P2034'])

export async function retryDb<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const code = (err as { code?: string })?.code
      if (!code || !TRANSIENT_PRISMA_CODES.has(code)) throw err
      // 250 ms, 750 ms — small enough to stay inside request budgets.
      await new Promise((r) => setTimeout(r, 250 * 3 ** i))
    }
  }
  throw lastError
}
