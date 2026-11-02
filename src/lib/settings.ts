// Cached platform settings accessor.
import { db } from '@/lib/db'

let cache: Record<string, string> | null = null
let cacheAt = 0
const TTL = 30_000

export const settings = {
  async all(): Promise<Record<string, string>> {
    if (cache && Date.now() - cacheAt < TTL) return cache
    const rows = await db.platformSetting.findMany()
    cache = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    cacheAt = Date.now()
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

// Eager-load once per process so synchronous `get` works on first request
void settings.all()
