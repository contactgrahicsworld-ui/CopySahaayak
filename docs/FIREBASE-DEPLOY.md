# CopySahaayak — Firebase App Hosting deployment (SECOND deployment)

Ye setup **Vercel production ke saath parallel** ek doosri deployment banata hai.
Original deploy (`https://copysahaayak.vercel.app`) **bilkul untouched** rehta hai —
ye files Vercel ko affect nahi karti (Vercel deploys sirf `scripts/deploy-sha.sh` se
API-call se hote hain, git-push se auto-deploy nahi hota).

## Kya banaya gaya hai

| File | Kaam |
| --- | --- |
| `firebase.json` | App Hosting backend config (`backendId: copysahaayak`, local-source deploy) |
| `apphosting.yaml` | Runtime/build env vars — sab Google Secret Manager backed (koi value commit nahi hui) |
| `scripts/deploy-firebase.sh` | One-command deploy: backend create → secrets sync → deploy → health smoke-test |

## Zaroori baatein (pehle padho)

1. **Blaze plan required**: Firebase App Hosting ke liye project ka
   **Blaze (pay-as-you-go)** plan hona zaroori hai — free (Spark) plan par App
   Hosting kaam nahi karta. Naye GCP accounts ko $300 free credit milta hai aur
   low-traffic usage free quota me rehta hai; phir bhi card link karna padega.
2. **Same database**: Firebase deployment **wahi Supabase Postgres** use karega —
   same shops, same orders, same users (live mirror). Alag/isolated DB chahiye to
   pehle batana hoga.
3. **Secrets**: Production env values (DATABASE_URL, SMTP_PASS, APP_SECRET, etc.)
   git me NAHI jaate — `deploy-firebase.sh` unhe directly Google Secret Manager me
   daalta hai, aur `firebase.json` ka `ignore` block source-upload se `.env*`,
   `.vercel-token` jaisi files bahar rakhta hai.

## Mujhe (assistant) se kya chahiye

1. **Firebase project ID** — <https://console.firebase.google.com> par project banao
   (ya existing ka ID). Blaze plan enable karo: Firebase Console → Usage & billing.
2. **Auth token** (koi ek):
   - Apne computer par: `npm install -g firebase-tools` → `firebase login:ci`
     → jo token print ho, wo mujhe bhejo (main use `.firebase-token` me daal dunga, gitignored), **ya**
   - Firebase Console → Project Settings → Service accounts → "Generate new private key"
     → JSON file bhejo (main GOOGLE_APPLICATION_CREDENTIALS ke roop me use karunga).
3. **Confirmation**: same Supabase DB shared rahega — theek hai?

## Fir main kya karunga

```bash
bash scripts/deploy-firebase.sh <PROJECT_ID>
```

- Backend `copysahaayak` (us-central1) banega
- 16 production secrets Secret Manager me set honge
- Local source se build + rollout hoga
- `/api/health` smoke-test hoga
- Naya URL milega: `https://<backend-id>-<random>-uc.a.run.app` jaisa
  (custom domain baad me jod sakte hain — Vercel wala domain untouched)

## Notes

- **Node/framework**: App Hosting Next.js 13.5+ support karta hai; ye app Next 16
  hai — agar build me adapter issue aaye to main turant fix karke dobara rollout
  karunga (Vercel par koi asar nahi).
- **Cron**: Vercel ke cron endpoints Firebase par auto-run nahi honge; agar chahiye
  to GCP Cloud Scheduler se baad me set karenge (optional).
- **Cost guard**: `runConfig` me `minInstances: 0, maxInstances: 4` — idle par
  minimal cost, spike par scale-up.
