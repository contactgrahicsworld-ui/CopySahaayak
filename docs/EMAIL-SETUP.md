# Email Setup — Resend (Password Reset OTP + Plan Reminders)

## Why Resend

| Transport | Sender | Spam risk | Rate limit |
| --- | --- | --- | --- |
| Supabase built-in (current fallback) | Shared Supabase sender | Often lands in spam/promotions | ~2–3 mails/hour per address |
| **Resend (recommended)** | **Your own verified domain** (`noreply@yourdomain`) | Verified DKIM/SPF → inbox | 100 mails/day free, 3,000/month |

The app automatically prefers Resend the moment `RESEND_API_KEY` exists —
no code change needed. Until then it keeps using the Supabase built-in
mailer, so password reset never breaks.

## Setup steps (15 minutes)

### 1. Create a free Resend account

1. Go to <https://resend.com> → **Sign up** (free plan, no credit card).
2. Dashboard → **API Keys** → **Create API Key** → name it `copysahaayak`
   → copy the key (starts with `re_`).

### 2. (Recommended) Verify your domain

`onboarding@resend.dev` can only mail YOUR OWN Resend account email until a
domain is verified. To send to any user (shop owners, super admin):

1. Resend Dashboard → **Domains** → **Add Domain** → enter a domain you own
   (e.g. `yourbusiness.com` — any domain works, it does not have to match the app URL).
2. Resend shows DNS records (DKIM TXT + SPF). Add them at your domain's DNS
   provider (GoDaddy / Namecheap / Cloudflare / etc.).
3. Wait for verification to turn **Verified** (usually minutes, can take a few hours).

No own domain? You can still start without one — Resend's test sender
(`onboarding@resend.dev`) delivers reliably to most inboxes, just with the
"via Resend" label. Add the domain later whenever ready.

### 3. Add the env vars to Vercel

Vercel Dashboard → **copysahaayak** project → Settings → **Environment
Variables** → add for **Production** (or ask the developer to add them):

| Key | Value |
| --- | --- |
| `RESEND_API_KEY` | `re_...` (from step 1) |
| `MAIL_FROM` | `CopySahaayak <noreply@yourdomain.com>` (skip until domain is verified) |

Then **Redeploy** (Deployments → latest → Redeploy) so the new env takes effect.

### 4. Verify

1. Open the app → Login → **Forgot password** → enter a real email.
2. The 6-digit code should arrive in the inbox within seconds.
3. On success the response is `{ok:true, sent:true}` — same shape as before.

## What switches automatically once `RESEND_API_KEY` is set

- Password-reset OTP mails go through Resend with your branded sender.
- **Plan-expiry reminder emails** (cron) turn on — with Supabase-only
  transport they stay in-app to protect the shared sender's rate limit.
- WhatsApp OTP delivery is independent (needs WhatsApp Cloud API keys —
  separate setup, currently not configured).

## Security notes

- Reset codes are 6-digit, single-use, 10-minute TTL, stored **hashed** —
  never the password itself.
- The reset endpoint re-verifies the code server-side; unknown emails get
  the same response shape and timing (no account enumeration).
- Never commit the API key: it lives only in Vercel env vars.
