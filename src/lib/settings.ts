// Cached platform settings accessor.
import { db } from '@/lib/db'

let cache: Record<string, string> | null = null
let cacheAt = 0
const TTL = 30_000

export const settings = {
  async all(): Promise<Record<string, string>> {
    if (cache && Date.now() - cacheAt < TTL) return cache
    try {
      const rows = await db.platformSetting.findMany()
      cache = Object.fromEntries(rows.map((r) => [r.key, r.value]))
      cacheAt = Date.now()
    } catch {
      // Unreachable DB (e.g. cold start / build-time evaluation) — fall back to
      // defaults rather than crashing the request; retried on the next call.
      cache = cache || {}
    }
    return cache
  },
  get(key: string, fallback = ''): string {
    return (cache && cache[key]) || fallback
  },
  get orderPrefix(): string {
    return this.get('order_prefix', 'PC')
  },
  async invalidate() {
    cache = null
  },
}
