// Scan-to-pay QR for shop-owner PLAN payments. Every plan subscription must be
// paid to the PLATFORM UPI (super admin), never to the shop's own order UPI.
// Returns a standard upi:// deep link + QR data-URL the owner scans in any UPI app.
import { db } from '@/lib/db'
import { handleRoute, jsonOk, jsonError } from '@/lib/api'
import { requireAnyShopAdmin } from '@/lib/auth'
import { settings } from '@/lib/settings'
import { buildUpiPayload } from '@/lib/upi'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  return handleRoute(req, {}, async () => {
    const ctx = await requireAnyShopAdmin()
    const planCode = new URL(req.url).searchParams.get('planCode') || ''
    if (!/^[A-Z]{3,20}$/.test(planCode)) return jsonError(400, 'Invalid plan code')

    const plan = await db.plan.findUnique({ where: { code: planCode } })
    if (!plan || !plan.isActive || plan.pricePaise <= 0) {
      return jsonError(404, 'Plan not found or not a paid plan')
    }

    const s = await settings.all()
    const vpa = s.super_admin_upi_vpa || ''
    if (!vpa) {
      return jsonError(409, 'Platform UPI is not configured yet. Please contact the platform admin.')
    }
    const payee = s.super_admin_payee_name || 'Platform'

    // Unique per-shop-per-minute reference so the platform can reconcile UTRs.
    const txnRef = `SUB${ctx.user.shopId.slice(-8)}${Date.now().toString(36).toUpperCase()}`
    const payload = buildUpiPayload({
      vpa,
      payeeName: payee,
      amountPaise: plan.pricePaise,
      txnRef,
      note: `${plan.code} plan`,
    })
    const dataUrl = await QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 480,
      color: { dark: '#111111', light: '#FFFFFF' },
    })

    return jsonOk({
      payload,
      dataUrl,
      txnRef,
      amountPaise: plan.pricePaise,
      vpa,
      payee,
      planCode: plan.code,
      planName: plan.name,
    })
  })
}
