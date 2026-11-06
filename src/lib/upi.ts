// Dynamic UPI QR generation — no payment gateway, no paid API.
// Standard `upi://` deep link works with GPay, PhonePe, Paytm, BHIM and bank apps.
import QRCode from 'qrcode'
import type { Shop } from '@prisma/client'

export interface UpiParams {
  vpa: string
  payeeName: string
  amountPaise: number
  txnRef: string // must be unique per order — enables reconciliation
  note: string
}

export function buildUpiPayload(p: UpiParams): string {
  const rupees = (p.amountPaise / 100).toFixed(2)
  // Real UPI apps are picky about encoding:
  //  - the payee VPA's "@" must stay literal — most apps (PhonePe, Paytm, bank
  //    apps) do NOT decode "%40" and show "invalid UPI ID";
  //  - spaces must be "%20" — the "application/x-www-form-urlencoded" "+"
  //    renders literally as "Manish+Mukherjee" in the app's payee screen.
  // encodeURIComponent emits %20 for spaces but %40 for @, so @ is restored.
  // Everything dangerous (&, =, #, +) stays percent-encoded.
  const enc = (v: string) => encodeURIComponent(v).replace(/%40/gi, '@')
  const params = [
    `pa=${enc(p.vpa)}`,
    `pn=${enc(p.payeeName.slice(0, 50))}`,
    `am=${rupees}`,
    `tr=${p.txnRef.replace(/[^a-zA-Z0-9]/g, '').slice(0, 35)}`,
    `tn=${enc(p.note.slice(0, 50))}`,
    'cu=INR',
  ]
  return `upi://pay?${params.join('&')}`
}

export async function generateUpiQr(shop: Pick<Shop, 'upiVpa' | 'upiPayeeName' | 'name'>, amountPaise: number, txnRef: string) {
  if (!shop.upiVpa) throw new Error('Shop has not configured a UPI ID')
  const payload = buildUpiPayload({
    vpa: shop.upiVpa,
    payeeName: shop.upiPayeeName || shop.name,
    amountPaise,
    txnRef,
    note: `${shop.name} ${txnRef}`,
  })
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 480,
    color: { dark: '#111111', light: '#FFFFFF' },
  })
  return { payload, dataUrl }
}
