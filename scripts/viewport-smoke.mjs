// Mobile viewport smoke test — verifies no horizontal cut on Android/iOS widths.
// For each page × viewport: loads the production server, waits for hydration,
// then checks document.scrollWidth <= innerWidth (no horizontal overflow).
// Any overflow FAILS with the offending element selector + width.
import { chromium } from 'playwright-core'

const BASE = process.env.BASE || 'http://localhost:3000'
const SHELL = '/home/z/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell'

const VIEWPORTS = [
  { name: 'iPhone SE (375×667, iOS Safari)', width: 375, height: 667, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  { name: 'Android small (320×640)', width: 320, height: 640, ua: 'Mozilla/5.0 (Linux; Android 11; SM-A015F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  { name: 'Android mid (360×800)', width: 360, height: 800, ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  { name: 'iPhone Pro Max (430×932, iOS)', width: 430, height: 932, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
]

const PAGES = ['/', '/login', '/register', '/forgot-password', '/setup', '/download', '/scan', '/track']

const browser = await chromium.launch({ executablePath: SHELL, args: ['--no-sandbox'] })
let failures = 0
let checks = 0

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    userAgent: vp.ua,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const page = await ctx.newPage()
  for (const path of PAGES) {
    try {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30000 })
      if (!res || res.status() >= 400) {
        // /scan may 404 by design (requires ?shop=...). Note it, don't fail.
        console.log(`  SKIP ${path} → HTTP ${res ? res.status() : '??'} on ${vp.width}px`)
        continue
      }
      await page.waitForTimeout(400) // hydration settle
      const r = await page.evaluate(() => {
        const doc = document.documentElement
        const overflow = doc.scrollWidth - doc.clientWidth
        let culprit = null
        if (overflow > 1) {
          const vw = doc.clientWidth
          for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect()
            if (b.right > vw + 1 && b.width > 8 && el.offsetParent !== null) {
              culprit = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(b.right)}`
              break
            }
          }
        }
        return { overflow, scrollW: doc.scrollWidth, clientW: doc.clientWidth, culprit }
      })
      checks++
      if (r.overflow > 1) {
        failures++
        console.log(`  ✗ ${path} @ ${vp.width}px  overflow ${r.overflow}px (scrollW ${r.scrollW} > clientW ${r.clientW})  culprit: ${r.culprit || '?'}`)
      } else {
        console.log(`  ✓ ${path} @ ${vp.width}px  no horizontal cut`)
      }
    } catch (e) {
      failures++
      console.log(`  ✗ ${path} @ ${vp.width}px  ERROR ${e.message.slice(0, 120)}`)
    }
  }
  await ctx.close()
}

await browser.close()
console.log(`\nVIEWPORT SMOKE: ${checks - failures} passed, ${failures} failed`)
process.exit(failures > 0 ? 1 : 0)
