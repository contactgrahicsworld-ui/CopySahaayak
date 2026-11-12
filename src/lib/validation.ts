// Zod validation schemas — every API mutation validates input here first.
import { z } from 'zod'
import { COLOR_MODES, PAPER_SIZES } from '@/lib/constants'

export const paperSizeSchema = z.enum(PAPER_SIZES)
export const colorModeSchema = z.enum(COLOR_MODES)

export const orderItemSchema = z.object({
  documentId: z.string().min(10).max(64),
  colorMode: colorModeSchema,
  paperSize: paperSizeSchema,
  duplex: z.boolean(),
  copies: z.number().int().min(1).max(500),
  pageFrom: z.number().int().min(1).max(2000).nullable().optional(),
  pageTo: z.number().int().min(1).max(2000).nullable().optional(),
})

// Indian mobile: optional +91/91 prefix, then 10 digits starting 6-9.
// Spaces/hyphens are stripped before this schema sees the value (normalisePhone).
export const indianMobileSchema = z
  .string()
  .transform((v) => v.replace(/[\s\-\u00a0]/g, ''))
  .refine((v) => /^(\+?91)?[6-9][0-9]{9}$/.test(v), 'Mobile number must be a valid 10-digit Indian number')
  .transform((v) => (v.startsWith('+91') ? v.slice(3) : v.startsWith('91') && v.length === 12 ? v.slice(2) : v))

export const createOrderSchema = z.object({
  // Mandatory customer identity: the shop must always know WHO the order belongs
  // to (naam + mobile), even when the customer never submits a UTR.
  customerName: z.string().trim().min(2, 'Name is required (kam se kam 2 letters)').max(80),
  customerPhone: indianMobileSchema,
  notes: z.string().trim().max(300).optional(),
  items: z.array(orderItemSchema).min(1).max(10),
})

export const submitUtrSchema = z.object({
  utr: z.string().trim().regex(/^[a-zA-Z0-9]{8,22}$/, 'UTR must be 8-22 letters/digits'),
  payerName: z.string().trim().max(60).optional(),
})

export const loginSchema = z.object({
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(100),
})

export const pricingRuleSchema = z.object({
  paperSize: paperSizeSchema,
  colorMode: colorModeSchema,
  singleSidedPaise: z.number().int().min(0).max(1000000),
  duplexPaise: z.number().int().min(0).max(1000000),
})

export const shopProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  ownerName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  whatsappNumber: z.string().trim().max(20).optional(),
  address: z.string().trim().max(300).optional(),
  upiVpa: z.string().trim().regex(/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z]{2,32}$/).optional().or(z.literal('')),
  upiPayeeName: z.string().trim().max(60).optional(),
})

export const verifyPaymentActionSchema = z.object({
  action: z.enum(['VERIFY', 'REJECT']),
  note: z.string().trim().max(300).optional(),
})

export const devicePairSchema = z.object({
  pairingCode: z.string().trim().regex(/^[A-Z0-9]{6}$/),
  machineName: z.string().trim().min(1).max(100),
  appVersion: z.string().trim().max(30).optional(),
})

export const heartbeatSchema = z.object({
  appVersion: z.string().trim().max(30).optional(),
  printers: z
    .array(
      z.object({
        windowsName: z.string().trim().min(1).max(120),
        colorMode: z.enum(['BW', 'COLOR', 'ANY']),
        paperSizes: z.array(z.string().trim().min(1).max(12)).max(20),
        // Connector-reported hardware health (WMI Win32_Printer). Absent = OK.
        healthStatus: z
          .enum(['OK', 'LOW_TONER', 'NO_TONER', 'LOW_PAPER', 'NO_PAPER', 'PAPER_JAM', 'OFFLINE', 'ERROR'])
          .optional(),
        healthDetail: z.string().trim().max(160).optional(),
      })
    )
    .max(20),
})

export const printEventSchema = z.object({
  status: z.enum(['SPOOLING', 'COMPLETED', 'FAILED']),
  message: z.string().trim().max(500).optional(),
})

export const routingRuleSchema = z.object({
  colorMode: colorModeSchema,
  paperSize: paperSizeSchema.nullable(),
  printerId: z.string().min(5),
})

export const createShopSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/, 'lowercase letters, digits and hyphens')
    .optional(),
  ownerName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  adminEmail: z.string().trim().email(),
  adminPassword: z.string().min(8).max(100),
  planCode: z.enum(['TRIAL', 'FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']).default('TRIAL'),
})

export const planSchema = z.object({
  name: z.string().trim().min(2).max(50).optional(),
  pricePaise: z.number().int().min(0).max(10000000).optional(),
  durationDays: z.number().int().min(1).max(3650).optional(),
  maxOrdersMonth: z.number().int().min(1).max(1000000).nullable().optional(),
  maxDevices: z.number().int().min(1).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
})

export const platformSettingSchema = z.object({
  key: z.string().trim().min(2).max(60),
  value: z.string().trim().max(200),
})

// ============ SIGNUP / SETUP / PASSWORD RESET (no predefined credentials) ============

export const newPasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one digit')

export const superResetPasswordSchema = z.object({
  userId: z.string().trim().min(10).max(60),
  newPassword: newPasswordSchema,
})

// Super Admin DELETE (Users tab): password of the CALLER confirms the action —
// a stolen session alone must never delete a platform owner. Target must be a
// SUPER_ADMIN; deleting the last active one re-opens the one-time /setup.
export const superDeleteUserSchema = z.object({
  userId: z.string().trim().min(10).max(60),
  password: z.string().min(1).max(200),
})

// Platform admin handover: the active super admin deactivates THEMSELVES with
// password confirmation (re-opens one-time /setup for a fresh platform admin).
export const superHandoverSchema = z.object({
  password: z.string().min(1).max(200),
})

// WhatsApp / contact number for the platform owner: lenient international
// format (optional +, 8-15 digits) with spaces/hyphens/brackets stripped
// before validation. Stored normalized (no separators).
export const whatsappNumberSchema = z
  .string()
  .transform((v) => v.replace(/[\s\-\u00a0().]/g, ''))
  .refine((v) => /^\+?[0-9]{8,15}$/.test(v), 'Enter a valid WhatsApp number (8-15 digits)')

export const setupSchema = z.object({
  // FULL creation form (owner request): name, email, password, confirm
  // password and WhatsApp number — the owner fills every field themselves on
  // /setup. UPI stays optional (also editable later in Settings).
  name: z.string().trim().min(2, 'Enter your name (kam se kam 2 letters)').max(80),
  email: z.string().trim().email().max(120),
  password: newPasswordSchema,
  phone: whatsappNumberSchema,
  // Platform UPI ID where all shop-owner plan/subscription payments are collected.
  upiVpa: z
    .string()
    .trim()
    .regex(/^[\w.\-]{2,60}@[a-zA-Z]{2,30}$/, 'Looks like name@bank (UPI ID)')
    .optional()
    .or(z.literal('')),
  upiPayeeName: z.string().trim().max(60).optional(),
  // Two-step legacy flow: one-time token issued by POST /api/setup/reset.
  claimToken: z.string().trim().min(16).max(200).optional(),
  // SIMPLE one-shot flow (owner request: "page complex mat banao"): the owner
  // pastes their recovery key straight into the creation form and the server
  // verifies it + does reset+create in ONE atomic transaction.
  resetKey: z.string().trim().min(16).max(200).optional(),
})

// Break-glass recovery: the deployment's SUPER_SETUP_RESET_KEY env value must be
// presented. Without the key this endpoint is indistinguishable from 404.
export const setupResetSchema = z.object({
  resetKey: z.string().min(16).max(200),
})

// Authority transfer (Power of Attorney) initiation: the CURRENT authority
// confirms their own password, then the new person gets a one-time email link.
export const transferInitiateSchema = z.object({
  toName: z.string().trim().min(2, 'Enter the new authority\'s name').max(80),
  toEmail: z.string().trim().email().max(120),
  currentPassword: z.string().min(1).max(200),
})

export const transferAcceptSchema = z.object({
  password: newPasswordSchema,
  name: z.string().trim().min(2).max(80).optional(),
})

export const registerSchema = z.object({
  ownerName: z.string().trim().min(2, 'Enter your full name').max(80),
  email: z.string().trim().email().max(120),
  password: newPasswordSchema,
  shopName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/, 'lowercase letters, digits and hyphens (3-40 chars)'),
  shopPhone: z.string().trim().max(20).optional(),
  shopAddress: z.string().trim().max(300).optional(),
  upiVpa: z
    .string()
    .trim()
    .regex(/^[\w.\-]{2,60}@[a-zA-Z]{2,30}$/, 'Looks like name@bank (UPI ID)')
    .optional()
    .or(z.literal('')),
  upiPayeeName: z.string().trim().max(60).optional(),
})

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(120),
})

export const resetPasswordSchema = z.object({
  email: z.string().trim().email().max(120),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your email'),
  password: newPasswordSchema,
})

// Self-service login-email change (super + shop admin): the CURRENT password
// proves ownership, the new email is validated like every other email input.
export const changeEmailSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newEmail: z.string().trim().email().max(120),
})
