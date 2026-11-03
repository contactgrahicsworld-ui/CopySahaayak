// Seed: platform settings + subscription plans ONLY.
// IMPORTANT: this seed intentionally creates NO user accounts, NO shops and NO
// credentials. The first Super Admin is created through /setup, shops through
// /register — nothing about authentication is predefined.
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const settings: Record<string, string> = {
    platform_name: 'CopySahaayak',
    super_admin_upi_vpa: '',
    super_admin_payee_name: 'CopySahaayak Platforms',
    support_phone: '',
    order_prefix: 'PC',
  }
  for (const [key, value] of Object.entries(settings)) {
    await prisma.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } })
  }

  const planDefs = [
    { code: 'FREE', name: 'Free', pricePaise: 0, durationDays: 3650, maxOrdersMonth: 50, maxStorageMb: 200, maxDevices: 4, maxStaff: 1, features: ['50 orders/month', '4 printers', '200 MB storage'], sortOrder: 1 },
    { code: 'STARTER', name: 'Starter', pricePaise: 19900, durationDays: 30, maxOrdersMonth: 500, maxStorageMb: 2048, maxDevices: 8, maxStaff: 2, features: ['500 orders/month', '8 printers (+4)', '2 GB storage', 'Email support'], sortOrder: 2 },
    { code: 'PROFESSIONAL', name: 'Professional', pricePaise: 49900, durationDays: 30, maxOrdersMonth: 3000, maxStorageMb: 10240, maxDevices: 12, maxStaff: 5, features: ['3,000 orders/month', '12 printers (+8)', '10 GB storage', 'Priority support'], sortOrder: 3 },
    { code: 'ENTERPRISE', name: 'Enterprise', pricePaise: 99900, durationDays: 90, maxOrdersMonth: null, maxStorageMb: 51200, maxDevices: 16, maxStaff: 20, features: ['Unlimited orders', '16 printers (+12)', '50 GB storage', 'Dedicated support'], sortOrder: 4 },
  ]
  for (const p of planDefs) {
    const { features, ...planData } = p
    const featuresJson = JSON.stringify(features)
    await prisma.plan.upsert({
      where: { code: p.code },
      update: {},
      create: { ...planData, featuresJson },
    })
  }
  console.log('Bootstrap complete: platform settings + 4 plans. No users/shops created by design.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
