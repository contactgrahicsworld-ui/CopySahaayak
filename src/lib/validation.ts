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

export const createOrderSchema = z.object({
  customerName: z.string().trim().max(80).optional(),
  customerPhone: z.string().trim().regex(/^[0-9+\-\s]{6,15}$/).optional(),
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
  planCode: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']).default('FREE'),
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

export const setupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  password: newPasswordSchema,
  phone: z.string().trim().max(20).optional(),
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
