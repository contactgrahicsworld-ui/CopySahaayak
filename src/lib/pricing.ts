// Server-authoritative pricing engine. The client NEVER decides the price.
import { db } from '@/lib/db'
import { LIMITS, type ColorMode, type PaperSize } from '@/lib/constants'
import { HttpError } from '@/lib/auth'

export interface PriceInput {
  shopId: string
  colorMode: ColorMode
  paperSize: PaperSize
  duplex: boolean
  copies: number
  pageFrom?: number | null
  pageTo?: number | null
  documentPageCount: number
}

export interface PriceResult {
  sides: number // printed sides per copy after range selection
  unitPricePaise: number // per side
  totalPaise: number
}

// Pure helpers (unit-tested) — DB layer applies them to PricingRule rows.
export function computeSides(pageCount: number, pageFrom?: number | null, pageTo?: number | null): number {
  const from = pageFrom ?? 1
  const to = pageTo ?? pageCount
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) return -1
  const clampedFrom = Math.min(Math.max(1, from), pageCount)
  const clampedTo = Math.min(Math.max(clampedFrom, to), pageCount)
  return clampedTo - clampedFrom + 1
}

export function computeTotal(unitSinglePaise: number, unitDuplexPaise: number, duplex: boolean, sides: number, copies: number): number {
  const unit = duplex ? unitDuplexPaise : unitSinglePaise
  return unit * sides * copies
}

export async function calculatePrice(input: PriceInput): Promise<PriceResult> {
  const { shopId, colorMode, paperSize, duplex, copies, documentPageCount } = input
  if (!Number.isInteger(copies) || copies < 1 || copies > LIMITS.maxCopies) {
    throw new HttpError(400, `Copies must be between 1 and ${LIMITS.maxCopies}`)
  }

  // Server-verified side count: page range is clamped to the REAL page count
  const sides = computeSides(documentPageCount, input.pageFrom ?? null, input.pageTo ?? null)
  if (sides < 1) {
    throw new HttpError(400, 'Invalid page range')
  }
  if (sides * copies > LIMITS.maxSides) throw new HttpError(400, 'Order too large, contact the shop')

  const rule = await db.pricingRule.findUnique({
    where: { shopId_paperSize_colorMode: { shopId, paperSize, colorMode } },
  })
  if (!rule || !rule.isActive) {
    throw new HttpError(400, `${paperSize} ${colorMode === 'BW' ? 'B/W' : 'Colour'} printing is not offered by this shop`)
  }
  const unitPricePaise = duplex ? rule.duplexPaise : rule.singleSidedPaise
  return { sides, unitPricePaise, totalPaise: unitPricePaise * sides * copies }
}

// Quote many items without persisting (used by customer UI price preview)
export async function quoteItems(shopId: string, items: PriceInput[]): Promise<{ totalPaise: number; results: PriceResult[] }> {
  let total = 0
  const results: PriceResult[] = []
  for (const item of items) {
    const r = await calculatePrice({ ...item, shopId })
    total += r.totalPaise
    results.push(r)
  }
  return { totalPaise: total, results }
}
