// Meta WhatsApp Cloud API transport — env-gated, fail-soft, never throws.
// Env vars (all optional; without them every send is a no-op "not-configured"):
//   WHATSAPP_TOKEN              permanent system-user token with whatsapp_business_messaging
//   WHATSAPP_PHONE_NUMBER_ID    sender phone number id (Graph API)
//   WHATSAPP_OTP_TEMPLATE       auth template for password-reset codes   (default: otp_code)
//   WHATSAPP_ORDER_TEMPLATE     marketing/utility template for order alerts (default: order_alert)
//   WHATSAPP_PLAN_TEMPLATE      utility template for plan-expiry reminders  (default: plan_expiry)
//
// Honesty rules (same as mailer): nothing is faked. Every send returns a
// result the caller can surface; failures are logged to audit via the caller.
// Business-initiated messages REQUIRE pre-approved Meta templates, so all
// sends are template-based — free-form text only reaches users who messaged
// the number within the last 24h, which we cannot assume for owners.
const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

export interface WaSendResult {
  ok: boolean
  status: 'sent' | 'not-configured' | 'invalid-phone' | 'failed'
  detail?: string
}

export function waConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID)
}

/** Strips spaces/dashes, maps Indian 10-digit/0-prefix/91-prefix numbers to E.164 digits (no +). Null when clearly invalid. */
export function normalizeWaPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let d = String(raw).replace(/[\s\-()]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  if (/^0\d{10}$/.test(d)) d = `91${d.slice(1)}` // 0XXXXXXXXXX → 91XXXXXXXXXX
  if (/^\d{10}$/.test(d)) d = `91${d}` // bare 10-digit → India
  if (d.startsWith('91') && d.length === 12) d = d // already E.164 digits
  if (!/^\d{10,15}$/.test(d)) return null
  return d
}

async function graphSend(payload: Record<string, unknown>): Promise<WaSendResult> {
  if (!waConfigured()) return { ok: false, status: 'not-configured' }
  try {
    const res = await fetch(`${GRAPH_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    })
    if (res.ok) return { ok: true, status: 'sent' }
    const body = (await res.text()).slice(0, 200)
    return { ok: false, status: 'failed', detail: `HTTP ${res.status}: ${body}` }
  } catch (err) {
    return { ok: false, status: 'failed', detail: err instanceof Error ? err.message.slice(0, 160) : 'network error' }
  }
}

/** Pre-approved template message. params = ordered body placeholders ({{1}}, {{2}}, …). */
export async function sendWhatsAppTemplate(
  rawPhone: string | null | undefined,
  template: string,
  params: string[],
  lang = 'en'
): Promise<WaSendResult> {
  const to = normalizeWaPhone(rawPhone)
  if (!to) return { ok: false, status: rawPhone ? 'invalid-phone' : 'not-configured' }
  return graphSend({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: template,
      language: { code: lang },
      ...(params.length ? { components: [{ type: 'body', parameters: params.map((p) => ({ type: 'text', text: p })) }] } : {}),
    },
  })
}

/** Convenience wrappers with the platform's template-name defaults. */
export async function sendOtpWhatsApp(phone: string | null | undefined, code: string): Promise<WaSendResult> {
  return sendWhatsAppTemplate(phone, process.env.WHATSAPP_OTP_TEMPLATE || 'otp_code', [code])
}

export async function sendOrderAlertWhatsApp(
  phone: string | null | undefined,
  orderNumber: string,
  statusText: string,
  note: string
): Promise<WaSendResult> {
  return sendWhatsAppTemplate(phone, process.env.WHATSAPP_ORDER_TEMPLATE || 'order_alert', [orderNumber, statusText, note])
}

export async function sendPlanExpiryWhatsApp(
  phone: string | null | undefined,
  shopName: string,
  planName: string,
  endDate: string,
  daysLeft: number
): Promise<WaSendResult> {
  return sendWhatsAppTemplate(phone, process.env.WHATSAPP_PLAN_TEMPLATE || 'plan_expiry', [
    shopName,
    planName,
    endDate,
    String(Math.max(0, daysLeft)),
  ])
}
