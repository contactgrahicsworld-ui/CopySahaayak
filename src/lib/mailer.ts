// Email transport abstraction:
//   0. SMTP (SMTP_HOST/PORT/USER/PASS, e.g. the Gmail app password already
//      configured in Supabase) — full attachments support, used by the weekly
//      backup/revenue reports
//   1. Resend HTTP API (RESEND_API_KEY)                   — plain HTTPS, attachments too
//   2. Supabase built-in mailer (SUPABASE_URL + keys)     — see src/lib/supabase.ts
//      (OTP-only; sendMail() cannot use it — no attachments, template locked)
//   3. Mock transport (MAIL_MOCK=1, test deployments only) — captured in-memory,
//      readable through the APP_SECRET-gated /api/test/outbox endpoint.
// The forgot/reset flow picks the first available transport; when none is
// configured the super admin can always reset a password from the platform UI.
import crypto from 'crypto'

export interface MailAttachment {
  filename: string
  /** Raw bytes (Node Buffer) or base64 string. */
  content: Buffer | string
  contentType?: string
}

export interface OutgoingMail {
  to: string
  subject: string
  text: string
  html: string
  attachments?: MailAttachment[]
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const MAIL_FROM = process.env.MAIL_FROM || 'CopySahaayak <onboarding@resend.dev>'

export const smtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS,
)

export const mailTransport = ((): 'smtp' | 'supabase' | 'resend' | 'mock' | 'none' => {
  // SMTP wins: real attachments (weekly Excel backups) + the same Gmail account
  // the platform already trusts for OTP mail. Resend is the HTTP fallback.
  if (smtpConfigured) return 'smtp'
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return 'supabase'
  if (process.env.MAIL_MOCK === '1') return 'mock'
  return 'none'
})()

export const mailEnabled = mailTransport !== 'none'

// ---- Mock capture (only when MAIL_MOCK=1) ----
const g = globalThis as unknown as { __cspMailOutbox?: OutgoingMail[] }
export function mockOutbox(): OutgoingMail[] {
  return (g.__cspMailOutbox ||= [])
}

async function sendViaResend(mail: OutgoingMail): Promise<void> {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      ...(mail.attachments?.length
        ? {
            attachments: mail.attachments.map((a) => ({
              filename: a.filename,
              content: typeof a.content === 'string' ? a.content : a.content.toString('base64'),
            })),
          }
        : {}),
    }),
  })
  if (res.status !== 200) {
    const detail = (await res.text()).slice(0, 200)
    throw new Error(`Resend send failed (${res.status}): ${detail}`)
  }
}

// Lazy-required so bundlers never pull nodemailer into client code.
async function sendViaSmtp(mail: OutgoingMail): Promise<void> {
  const nodemailer = await import('nodemailer')
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_PORT || '465') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments?.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
  })
}

async function sendViaMock(mail: OutgoingMail): Promise<void> {
  const box = mockOutbox()
  box.push(mail)
  if (box.length > 50) box.splice(0, box.length - 50)
}

/** Sends mail through the configured non-Supabase transport. Throws on failure. */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (mailTransport === 'smtp') return sendViaSmtp(mail)
  if (mailTransport === 'resend') return sendViaResend(mail)
  if (mailTransport === 'mock') return sendViaMock(mail)
  throw new Error('No email transport configured')
}

// ---- OTP helpers (app-issued codes, hashed at rest) ----

export function generateOtp(): string {
  // 6 digits, unbiased enough for a 10-minute single-use window
  return (100000 + crypto.randomInt(900000)).toString()
}

export function hashOtp(code: string): string {
  return crypto.createHash('sha256').update(`csp-otp:${code}`).digest('hex')
}

export function otpEmailTemplate(code: string, purpose: 'reset' = 'reset'): { subject: string; text: string; html: string } {
  const subject = 'CopySahaayak password reset code / पासवर्ड रीसेट कोड'
  const text = [
    'Your CopySahaayak password reset code:',
    '',
    code,
    '',
    `This code expires in 10 minutes. If you did not request it, you can ignore this email.`,
    '',
    'आपका CopySahaayak पासवर्ड रीसेट कोड ऊपर दिया गया है। यह कोड 10 मिनट में समाप्त हो जाएगा।',
  ].join('\n')
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;background:#f6f7f9;padding:24px">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #e5e7eb">
<h2 style="margin:0 0 8px;color:#111827">CopySahaayak</h2>
<p style="color:#374151;font-size:15px">${purpose === 'reset' ? 'Use this one-time code to reset your password:' : ''}</p>
<div style="font-size:34px;font-weight:700;letter-spacing:10px;text-align:center;padding:16px;background:#f3f4f6;border-radius:8px;color:#111827">${code}</div>
<p style="color:#6b7280;font-size:13px">This code expires in 10 minutes • यह कोड 10 मिनट के लिए मान्य है</p>
<p style="color:#9ca3af;font-size:12px">If you did not request a password reset, you can safely ignore this email.</p>
</div></body></html>`
  return { subject, text, html }
}
