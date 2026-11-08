// Shared domain constants — single source of truth for the SaaS + Windows connector contract.

export const PAPER_SIZES = ['A4', 'A3', 'A5', 'LEGAL'] as const
export type PaperSize = (typeof PAPER_SIZES)[number]

export const COLOR_MODES = ['BW', 'COLOR'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const DEVICE_COLOR_MODES = ['BW', 'COLOR', 'ANY'] as const
export type DeviceColorMode = (typeof DEVICE_COLOR_MODES)[number]

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'AWAITING_VERIFICATION',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const PAYMENT_STATUSES = ['PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PRINT_JOB_STATUSES = ['QUEUED', 'CLAIMED', 'SPOOLING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const
export type PrintJobStatus = (typeof PRINT_JOB_STATUSES)[number]

export const USER_ROLES = ['SUPER_ADMIN', 'SHOP_ADMIN', 'SHOP_STAFF'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const PLAN_CODES = ['TRIAL', 'FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE'] as const

// Business limits (server-enforced)
export const LIMITS = {
  maxCopies: 500,
  maxSides: 2000,
  maxUploadBytes: 25 * 1024 * 1024, // 25 MB
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] as const,
  signedUrlTtlMs: 10 * 60 * 1000, // 10 min for customer previews
  deviceDownloadTtlMs: 30 * 60 * 1000, // 30 min for connector downloads
  claimLeaseMs: 10 * 60 * 1000, // print job claim lease
  pairingCodeTtlMs: 15 * 60 * 1000,
  sessionTtlMs: 30 * 24 * 3600 * 1000, // admin sessions: 30 days
  customerSessionTtlMs: 7 * 24 * 3600 * 1000,
}

export const COOKIES = {
  admin: 'pcs_session',
  customer: (shopId: string) => `pcs_c_${shopId.replace(/[^a-zA-Z0-9]/g, '')}`,
}

export function formatInr(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const p = paise % 100
  return `₹${rupees.toLocaleString('en-IN')}${p ? `.${p.toString().padStart(2, '0')}` : ''}`
}
