// Terms of Service — simple Hinglish, written for shop owners (not lawyers).
// Facts match real platform behavior: UPI-direct payments, manual UTR verify,
// 7-day trial, flat subscription, retention windows from the retention cron.
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollText } from 'lucide-react'

export const metadata = {
  title: 'Terms of Service — CopySahaayak',
  description: 'CopySahaayak service ki shartein — payment, subscription, account aur data rules.',
}

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. Service kya hai',
    body: [
      'CopySahaayak ek photocopy/print shop automation platform hai. Dukaan apna QR code platform se banati hai; customer wo QR scan karke apni files upload karta hai aur order deta hai. Shop ke Windows computer par chalne wala "Desktop Sahaayak" connector order ke files ko shop ke printer par bhejta hai.',
      'Platform payment gateway nahi hai. Customer ka payment UPI se SIDHA dukaan ke apne bank account me jaata hai. Platform customer ke paise ko kabhi haath me nahi leta — na commission kaatta hai, na payment hold karta hai.',
    ],
  },
  {
    title: '2. Account aur zimmedari',
    body: [
      'Dukaan (shop owner) apne account ki security ke liye zimmedar hai — password kisi se share na karein. Platform sirf ek hi active Super Admin allow karta hai; shop accounts apne owner ke control me hote hain.',
      'Dukaan ki zimmedari hai ki wo sirf wo files print kare jo uske customers ne order kiye hain. Platform sirf software deta hai, printing ki quality aur delivery dukaan ki zimmedari hai.',
    ],
  },
  {
    title: '3. Subscription aur payment',
    body: [
      'Naya shop 7 din ka free trial milta hai — koi card nahi maanga jaata. Trial khatam hone se pehle shop owner koi paid plan chun sakta hai (STARTER / PROFESSIONAL / ENTERPRISE).',
      'Plan ke paise flat subscription hain — platform customers ke payments me se kuch nahi kaatta. Subscription ka payment platform admin ke UPI ID par kiya jaata hai; payment ka proof (UTR number) shop khud submit karti hai, platform admin use verify karke plan activate karta hai.',
      'Plan expire hone par service limit ho jaati hai (order accept band etc.). Platform 7, 3, 1 aur 0 din pehle reminder bhejta hai. Purane trial par wapas jaane ki suvidha platform admin ke paas hai (RESET_PLAN_TRIAL).',
    ],
  },
  {
    title: '4. Refund policy',
    body: [
      'Subscription ek baar verify hone par wapas nahi hoti, kyunki plan activate hote hi poori service available ho jaati hai.',
      'Agar platform ke technical fault ki wajah se service kisi poore billing month me use hi nahi ho payi, to shop support email par likhe — proof ke baad agle cycle me pro-rata credit diya jaayega. 7-din ka free trial isi liye diya jaata hai ki shop pehle sab kuch aazma ke phir paise de.',
    ],
  },
  {
    title: '5. Data aur files',
    body: [
      'Customer files (PDF/JPG/PNG) private storage me jaati hain aur sirf usi dukaan ke admin/staff aur customer ke apne session se dikh sakti hain. Shop delete karne par uski files, orders aur users ka poora data platform se delete kar diya jaata hai (full offboard).',
      'System logs (audit, print events, notifications) 90 din purane hone par auto-delete hote hain; expired password-reset codes 24 ghante me, stale customer sessions 180 din me saaf ho jaate hain. Detail ke liye Privacy Policy page dekhein.',
    ],
  },
  {
    title: '6. Upti / downtime aur liability',
    body: [
      'Platform Vercel + Supabase (cloud infrastructure) par chalta hai. Hum service ko reliable rakhne ki poori koshish karte hain, par kabhi-kabhi downtime ya bug ho sakte hai. Bade nuksaan (jaise printer me galat file chhap jaana) se bachne ke liye connector sirf verified order files hi print karta hai.',
      'Platform ki total liability kisi bhi case me us shop ke pichhle 1 month ke subscription se zyada nahi hogi. Platform India me govern hota hai.',
    ],
  },
  {
    title: '7. Account band karna',
    body: [
      'Shop owner apna data poora rakh sakte hain jab tak plan active hai. Agar dukaan service band karna chahe, platform admin se request karein — shop delete karne par data poora hata diya jaata hai.',
      'Agar koi dukaan platform ke rules ke khilaaf use kare (jaise illegal content print karwana), platform admin us shop ko suspend ya delete kar sakta hai. Illegal content ke liye poori zimmedari order karne wale aur print karane wale ki hai.',
    ],
  },
]

export default function TermsPage() {
  return (
    <main className="min-h-svh bg-background py-10">
      <div className="container mx-auto px-4 max-w-3xl space-y-4">
        <div className="flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-muted-foreground" aria-hidden />
          <h1 className="text-2xl font-bold tracking-tight">Terms of Service</h1>
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
                Koi sawaal ya complaint ho to email karein: <b>contact.grahicsworld@gmail.com</b> ·{' '}
                <Link href="/privacy" className="underline">
                  Privacy Policy
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
