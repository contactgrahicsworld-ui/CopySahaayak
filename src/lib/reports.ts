// Shared report helpers: period bucketing for revenue series.
export type Bucket = 'day' | 'week' | 'month'

export function bucketKey(date: Date, bucket: Bucket): string {
  const d = new Date(date)
  if (bucket === 'month') return d.toISOString().slice(0, 7)
  if (bucket === 'week') {
    // ISO week: label by the Monday that starts the week
    const day = (d.getUTCDay() + 6) % 7 // 0 = Monday
    const monday = new Date(d)
    monday.setUTCDate(d.getUTCDate() - day)
    return monday.toISOString().slice(0, 10)
  }
  return d.toISOString().slice(0, 10)
}

export function parseBucket(raw: string | null): Bucket {
  return raw === 'week' || raw === 'month' ? raw : 'day'
}
