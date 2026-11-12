// Privacy Policy — every statement matches real platform behavior:
// - customer files: private Supabase storage, shop-scoped access, magic-byte validated
// - sessions: cookie-based, no ad trackers, no third-party analytics
// - retention windows: from src/app/api/cron/retention/route.ts (90d logs,
//   24h OTPs, 180d stale guest sessions, 24h dead sessions)
// - payments: platform never touches customer money (UPI direct to shop)
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ShieldCheck } from 'lucide-react'

export const metadata = {
  title: 'Privacy Policy — CopySahaayak',
  description: 'Aapka data kya hai, kahan store hota hai, kitne din rakha jaata hai — poori sachai me.',
}

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. Hum kaun se data collect karte hain',
    body: [
      'Shop owner se: dukaan ka naam, owner ka naam, email, password (encrypted/bcrypt — humara staff bhi nahi padh sakta), phone/WhatsApp number, UPI ID (payments apne account me lene ke liye) aur shop address (optional).',
      'Customer (QR scan karne wale) se: order ke liye upload ki gayi files (sirf PDF/JPG/PNG allowed), order details (copies, pages, amount) aur ek sirf-usi-order-ke-liye guest session. Customer se account banne ki zarurat nahi hoti.',
      'Technical data: server ke andar security logs (kaun kab login hua, kya action hua) — ye sirf platform ke apne admin dekh sakta hai.',
    ],
  },
  {
    title: '2. Files kahan aur kaise rakhi jaati hain',
    body: [
      'Files private cloud storage (Supabase Storage) me jaati hain — public URL nahi hota. Har upload ka content check hota hai (magic-byte validation), sirf asli PDF/JPG/PNG accept hota hai.',
      'File sirf usi dukaan ke admin/staff aur usi customer ke order session se dikh sakti hai jo wo order banata hai. Doosri dukaan ya koi ajnabi wo file access nahi kar sakta.',
      'Dukaan delete hone par uski saari files aur orders poore delete kar diye jaate hain. Customer chahe to apne order page se file delete kar sakta hai jab tak order pending hai.',
    ],
  },
  {
    title: '3. Data kitne din rakha jaata hai (retention)',
    body: [
      'Order files aur order records: jab tak dukaan apna account rakhti hai. Dukaan band hone par poora tenant data delete.',
      'Security/audit logs, print events, in-app notifications: 90 din baad auto-delete.',
      'Password reset codes (OTP): use hone ya expire hone ke 24 ghante baad delete.',
      'Customer ke guest sessions: 180 din tak inactive rahe to delete. Admin ke login sessions: expire/revoke hone ke 24 ghante baad delete.',
    ],
  },
  {
    title: '4. Cookies aur tracking',
    body: [
      'Platform sirf 2 tarah ke cookies rakhta hai: (a) dukaan/admin ke login session ka cookie, (b) customer ke order session ka cookie. In dono ke bina login aur order kaam nahi karta.',
      'Hum koi advertising cookie, third-party analytics ya social-media tracker use NAHI karte. Aapko kisi ad network me track nahi kiya jaata.',
    ],
  },
  {
    title: '5. Paise ka data',
    body: [
      'Customer ka UPI payment SIDHA dukaan ke bank account me jaata hai — platform is paise ko dekh bhi nahi sakta, na hi rakhta hai. Platform sirf ye record rakhta hai ki order ka kitna amount maanga gaya aur UTR (payment proof number) verify hua ya nahi.',
      'Subscription payment me platform admin ka UPI ID use hota hai aur shop wala UTR number record hota hai — isi se plan activate hota hai. Payment gateway nahi hai, isliye card/bank details platform ko kabhi nahi di jaati.',
    ],
  },
  {
    title: '6. Data kisse milta hai (sharing)',
    body: [
      'Aapka data sirf 2 infrastructure providers ke paas jaata hai: Supabase (database + file storage) aur Vercel (website hosting) — dono industry-standard security rakhte hain. Hum aapka data bechte nahi, kisi ad company ko nahi dete, aur kisi ko marketing ke liye nahi bhejte.',
      'WhatsApp/email notifications (order alerts, OTP) bhejne ke liye message provider ko sirf aapka email/phone number jaata hai — jab wo provider configured ho. Bina provider ke in-app notification hi dikhta hai, kuch fake nahi bheja jaata.',
    ],
  },
  {
    title: '7. Aapke adhikaar',
    body: [
      'Shop owner apna data kabhi bhi export/deletion ki request kar sakte hain — support email par likhein, hum poori madad karenge. Account delete karne par backup ke sath data poora hata diya jaata hai.',
      'Customer (guest) apni file order page se hi delete kar sakta hai; ya dukaan se apne order ka data hatane ki request kar sakta hai.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-svh bg-background py-10">
      <div className="container mx-auto px-4 max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight">Privacy Policy</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Effective date: 12 November 2026 · Service: CopySahaayak (Photocopy Shop Automation SaaS)
        </p>
        <Card>
          <CardContent className="pt-6 space-y-5">
            {SECTIONS.map((s) => (
              <section key={s.title}>
                <h2 className="font-semibold mb-1.5">{s.title}</h2>
                {s.body.map((p, i) => (
                  <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                    {p}
                  </p>
                ))}
              </section>
            ))}
            <section>
              <h2 className="font-semibold mb-1.5">8. Contact / sahara</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Data se related koi bhi sawaal: <b>contact.grahicsworld@gmail.com</b> ·{' '}
                <Link href="/terms" className="underline">
                  Terms of Service
                </Link>{' '}
                ·{' '}
                <Link href="/" className="underline">
                  Home
                </Link>
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
