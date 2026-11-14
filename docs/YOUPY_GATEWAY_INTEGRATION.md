# YouPI PG Gateway — CopySahaayak Integration Guide (owner ke liye)

CopySahaayak me **YouPI PG V2** gateway integrate ho chuka hai (deploy `797e44d`, dpl_BFmRmzgqcrv8RCwkDLq9c7o2Bqdm). Ye guide batati hai ki gateway server kaise chalana hai aur CopySahaayak se kaise jodna hai.

## Kya-kya auto ho jayega (integration ke baad)

| Payment | Pehle (manual) | Ab (gateway) |
| --- | --- | --- |
| Customer → Shop (order) | QR scan → UTR submit → shop admin haath se verify → print jobs | Customer "Online Pay" button dabata hai → hosted checkout (GPay/PhonePe/Paytm) → gateway credit detect → signed webhook → **order auto-CONFIRM + print jobs turant queue** |
| Shop → Platform (plan) | QR scan → UTR → super admin UTR check → plan activate | Shop "Gateway se Pay — Auto-Activate" dabata hai → checkout → webhook verify → **plan auto-ACTIVATE + shop re-activate** |

Manual UTR tarika fallback me poora available rahega — gateway config na ho to UI khud usi par wapas aa jata hai.

## Step 1 — YouPI server host karo (Vercel par NAHI chalega)

Ye gateway self-hosted hai (SQLite + bank observers + long-running services). Chahiye:

- **Ek server/host**: chhota VPS (Hetzner/DO/AWS Lightsail ~$5/mo) ya apna Windows/Linux PC jo mostly on rahe. Node.js **>= 22.13.0** (24 LTS best).
- **2 Android phones** (observer ke liye) — ek jo shop ke receiving bank ka SMS de, ek platform ke bank ka (Gmail observer bhi supported).

```bash
git clone https://github.com/youpi-pg/YouPI-PG.git youpi-pg
cd youpi-pg && npm install
cp .env.example .env   # ENCRYPTION_MASTER_KEY generate karna hai (64-hex)
npm run dev            # ya npm start (production)
```

Services: Payment API `:6100`, Checkout Portal `:7000`, Merchant Admin `:6001`, Control Center `:8090`.
Public domain lagao (e.g. `pay.aapkadomain.com` → port 7000 checkout + 6100 API, Caddy/nginx SSL). Server ka `curl http://localhost:6100/health` → `{"status":"UP"}` hona chahiye.

**Important (gateway ke apne rules):** ek receiving account par ek waqt me ek hi active payment session (FIFO queue); test 20 txn/day/account se kam rakho; bank statement import (reconciliation) ka setup karo — tabhi sabse-strong `RECONCILED` events milte hain.

## Step 2 — Merchants banao (YouPI Merchant Admin `:6001` par)

1. **Platform merchant** — receiving account = aapka (super admin) UPI/bank. Iska `Merchant ID`, `API Key`, `Webhook Secret` copy karo.
2. **Har shop ke liye ek merchant** — receiving account = us shop ka UPI (jo shop owner ne CopySahaayak me set kiya hai). Har shop ka `Merchant ID`, `API Key`, `Webhook Secret`, `Public Key` alag hoga.

## Step 3 — CopySahaayak me config karo

**Super Admin** (https://copysahaayak.vercel.app/super) → Settings → "YouPI PG Gateway":
- Gateway server URL: `https://pay.aapkadomain.com`
- Platform merchant ka ID / API key / webhook secret / public key
- Strictness: **Strict (recommended)** = sirf bank-statement matched (RECONCILED) payments auto-activate; Fast = bank SMS alert par bhi activate
- Webhook URL YouPI merchant me set karo: `https://copysahaayak.vercel.app/api/webhooks/youpi`
- YouPI side: `YOUPI_ALLOWED_ORIGINS` + `YOUPI_ALLOWED_RETURN_ORIGINS` me `https://copysahaayak.vercel.app` exact (no wildcard)

**Har Shop Owner** apne dashboard → Settings → "Online Payment Gateway" → apne merchant ke credentials daal kar Gateway ON.

## Step 4 — Verify (ek real ₹1 test)

1. Shop se ek ₹1 ka test order → "Online Pay" → apne UPI app se pay karo
2. Observer alert aayega → gateway webhook bhejega → order page 8 sec me CONFIRMED dikhana chahiye, print jobs queue me
3. Plan payment bhi ₹1 test karo (agar plan pricing allow kare) ya real upgrade
4. GatewayEvent table me delivery dikhegi (accepted=true) — super admin audit me bhi

## Security jo already built hai

- Webhook HMAC-SHA256 (v1 raw + v2 timestamp-bound) — 14/14 interop tests gateway ke signer ke khilaf pass
- deliveryId dedupe (retry-safe), har delivery persist (audit trail, accepted/rejected+reason)
- Per-scope secret: shop ka gateway kisi doosri shop ka payment ya plan confirm NAHI kar sakta
- Amount paise-precision me exact match; COD/expired/method!=UPI kabhi advance nahi karte
- API keys sirf server par — browser ko sirf hosted checkoutUrl milta hai
- Gateway verify hone par hi auto-advance; transaction me status re-check (replay se double-activate impossible)

## Trust model (imaandaar baat)

YouPI khud apne docs me kehta hai: observer alert (`OBSERVED_SUCCESS`) settlement ka PROOF nahi hai — bank SMS parse hota hai. Isliye default **RECONCILED-only** rakha hai (alert + aapka imported bank statement match). Fast mode aapki marzi par on ho sakta hai. Manual UTR verify hamesha fallback me hai.
