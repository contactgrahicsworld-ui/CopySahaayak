// Platform bootstrap: plans + platform settings are DATA every deployment needs.
// They are provisioned idempotently on first setup/register — never seeded with
// any user account, so no credential is ever predefined or hardcoded.
import { db } from '@/lib/db'

interface PlanDef {
  code: string
  name: string
  pricePaise: number
  durationDays: number
  maxOrdersMonth: number | null
  maxStorageMb: number
  maxDevices: number
  maxStaff: number
  features: string[]
  sortOrder: number
}

const PLAN_DEFS: PlanDef[] = [
  { code: 'TRIAL', name: 'Trial (7 din)', pricePaise: 0, durationDays: 7, maxOrdersMonth: 100, maxStorageMb: 500, maxDevices: 1, maxStaff: 1, features: ['7-day free trial', '100 orders/month', '1 device', '500 MB storage'], sortOrder: 0 },
  // FREE is legacy: existing shops may still sit on it, but it is closed for NEW
  // assignments — new shops start on the 7-day TRIAL and must pick a paid plan
  // afterwards (the super admin can re-activate FREE from Plans if ever needed).
  // Duration is capped at 7 days so a FREE plan can never again hand out a
  // 10-year clock to a shop (the old 3650-day value was a display blunder).
  { code: 'FREE', name: 'Free', pricePaise: 0, durationDays: 7, maxOrdersMonth: 50, maxStorageMb: 200, maxDevices: 1, maxStaff: 1, features: ['50 orders/month', '1 device', '200 MB storage'], sortOrder: 1 },
  { code: 'STARTER', name: 'Starter', pricePaise: 19900, durationDays: 30, maxOrdersMonth: 500, maxStorageMb: 2048, maxDevices: 1, maxStaff: 2, features: ['500 orders/month', '1 device', '2 GB storage', 'Email support'], sortOrder: 2 },
  { code: 'PROFESSIONAL', name: 'Professional', pricePaise: 49900, durationDays: 30, maxOrdersMonth: 3000, maxStorageMb: 10240, maxDevices: 3, maxStaff: 5, features: ['3,000 orders/month', '3 devices', '10 GB storage', 'Priority support'], sortOrder: 3 },
  { code: 'ENTERPRISE', name: 'Enterprise', pricePaise: 99900, durationDays: 90, maxOrdersMonth: null, maxStorageMb: 51200, maxDevices: 10, maxStaff: 20, features: ['Unlimited orders', '10 devices', '50 GB storage', 'Dedicated support'], sortOrder: 4 },
]

const SETTINGS: Record<string, string> = {
  platform_name: 'CopySahaayak',
  super_admin_upi_vpa: '',
  super_admin_payee_name: 'CopySahaayak Platforms',
  support_phone: '',
  order_prefix: 'PC',
}

export async function ensurePlatformBootstrap(): Promise<void> {
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db.platformSetting.upsert({ where: { key }, update: {}, create: { key, value } })
  }
  for (const p of PLAN_DEFS) {
    const { features, ...planData } = p
    const featuresJson = JSON.stringify(features)
    // FREE is closed for new assignments everywhere the platform bootstraps —
    // update (not just create) so existing deployments get the trial model too.
    const update = p.code === 'FREE' ? { isActive: false, durationDays: 7 } : {}
    await db.plan.upsert({
      where: { code: p.code },
      update,
      create: { ...planData, featuresJson },
    })
  }
  // Legacy-data hygiene: any shop still parked on the old multi-year FREE plan
  // moves to the 7-day TRIAL with a fresh 7-day window, so its dashboard clock
  // never shows a bogus 10-year countdown again. Idempotent: after this runs,
  // no subscription remains on FREE (downgrades target TRIAL, registration
  // creates TRIAL, and FREE stays closed for new assignments).
  const free = await db.plan.findUnique({ where: { code: 'FREE' } })
  const trial = await db.plan.findUnique({ where: { code: 'TRIAL' } })
  if (free && trial) {
    const legacy = await db.subscription.findMany({ where: { planId: free.id }, select: { id: true } })
    if (legacy.length) {
      const now = new Date()
      const trialExpiry = new Date(now.getTime() + trial.durationDays * 86400_000)
      await db.subscription.updateMany({
        where: { planId: free.id },
        data: { planId: trial.id, status: 'ACTIVE', startsAt: now, expiresAt: trialExpiry },
      })
      console.log(`[bootstrap] migrated ${legacy.length} legacy FREE subscription(s) to the 7-day TRIAL`)
    }
  }
}

/** Sensible default price book for a new shop — fully editable in the admin dashboard. */
export function defaultPricingRules(): Array<{ paperSize: string; colorMode: string; singleSidedPaise: number; duplexPaise: number }> {
  const sizes = ['A4', 'A3', 'A5', 'LEGAL']
  const rules: Array<{ paperSize: string; colorMode: string; singleSidedPaise: number; duplexPaise: number }> = []
  const single: Record<string, { bw: number; color: number }> = {
    A4: { bw: 200, color: 800 },
    A3: { bw: 400, color: 1500 },
    A5: { bw: 150, color: 600 },
    LEGAL: { bw: 250, color: 1000 },
  }
  for (const size of sizes) {
    rules.push({ paperSize: size, colorMode: 'BW', singleSidedPaise: single[size].bw, duplexPaise: Math.round(single[size].bw * 0.9) })
    rules.push({ paperSize: size, colorMode: 'COLOR', singleSidedPaise: single[size].color, duplexPaise: Math.round(single[size].color * 0.9) })
  }
  return rules
}
