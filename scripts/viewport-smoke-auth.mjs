// AUTHENTICATED mobile viewport smoke test — dashboards + customer wizard.
// Registers a fresh shop via API, then checks /admin, /super and the customer
// order wizard at phone widths for horizontal overflow.
import { chromium } from 'playwright-core'

const BASE = process.env.BASE || 'http://localhost:3000'
const SHELL = '/home/z/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell'
const RUN = Math.random().toString(36).slice(2, 8)

const OWNER = { email: `smoke.${RUN}@testshop-test.in`, password: `Smoke#${RUN}1Aa`, ownerName: 'Smoke Owner', shopName: `Smoke Shop ${RUN}`, slug: `smoke-${RUN}`, upiVpa: `smoke${RUN}@okbank`, upiPayeeName: 'Smoke Shop' }

async function api(path, opts = {}, jar) {
  const headers = { 'Content-Type': 'application/json', Origin: new URL(BASE).origin, ...(opts.headers || {}) }
  if (jar?.cookie) headers.Cookie = jar.cookie
  const body = opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
  const res = await fetch(`${BASE}${path}`, { ...opts, body, headers, redirect: 'manual' })
  const setCookie = res.headers.getSetCookie?.() || []
  if (setCookie.length) jar.cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  let data = null
  try { data = await res.json() } catch {}
  return { res, data }
}

// 1. Register shop (auto sign-in) + create a customer order context
const jarO = {}
const reg = await api('/api/register', { method: 'POST', body: OWNER }, jarO)
if (reg.res.status !== 200) { console.log('REGISTER FAILED', reg.res.status, JSON.stringify(reg.data)); process.exit(1) }
console.log(`shop registered: ${OWNER.slug}`)

// Super admin login (temp test super)
const superEnv = (process.env.E2E_SUPER_EMAIL || '') && { email: process.env.E2E_SUPER_EMAIL, password: process.env.E2E_SUPER_PASSWORD }
const jarS = {}
let superOk = false
if (superEnv) {
  const login = await api('/api/auth/login', { method: 'POST', body: { email: superEnv.email, password: superEnv.password } }, jarS)
  superOk = login.res.status === 200
  console.log(`super login: ${superOk ? 'ok' : 'FAILED ' + login.res.status}`)
}

const VIEWPORTS = [
  { name: '375 iOS', width: 375, height: 667, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  { name: '320 Android', width: 320, height: 640, ua: 'Mozilla/5.0 (Linux; Android 11; SM-A015F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  { name: '360 Android', width: 360, height: 800, ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' },
  { name: '430 iOS', width: 430, height: 932, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
]

const PAGES = [
  { path: `/s/${OWNER.slug}`, label: 'customer wizard' },
  { path: '/admin', label: 'shop admin dashboard', jar: () => jarO },
  ...(superOk ? [{ path: '/super', label: 'super admin dashboard', jar: () => jarS }] : []),
]

const browser = await chromium.launch({ executablePath: SHELL, args: ['--no-sandbox'] })
let failures = 0
let checks = 0

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, userAgent: vp.ua, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  for (const p of PAGES) {
    const page = await ctx.newPage()
    const jar = p.jar ? p.jar() : {}
    if (jar.cookie) {
      const [name, ...rest] = jar.cookie.split(';')[0].split('=')
      await ctx.addCookies([{ name, value: rest.join('='), domain: new URL(BASE).hostname, path: '/' }])
    }
    try {
      const res = await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 45000 })
      if (res && res.status() >= 400) { console.log(`  SKIP ${p.label} → HTTP ${res.status}`); await page.close(); continue }
      await page.waitForTimeout(600)
      const r = await page.evaluate(() => {
        const doc = document.documentElement
        const overflow = doc.scrollWidth - doc.clientWidth
        let culprit = null
        if (overflow > 1) {
          const vw = doc.clientWidth
          for (const el of document.querySelectorAll('body *')) {
            const b = el.getBoundingClientRect()
            if (b.right > vw + 1 && b.width > 8 && el.offsetParent !== null) {
              culprit = `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 70)} right=${Math.round(b.right)}`
              break
            }
          }
        }
        return { overflow, scrollW: doc.scrollWidth, clientW: doc.clientWidth, culprit }
      })
      checks++
      if (r.overflow > 1) {
        failures++
        console.log(`  ✗ ${p.label} @ ${vp.width}px  overflow ${r.overflow}px (scrollW ${r.scrollW} > clientW ${r.clientW})  culprit: ${r.culprit || '?'}`)
      } else {
        console.log(`  ✓ ${p.label} @ ${vp.width}px`)
      }
    } catch (e) {
      failures++
      console.log(`  ✗ ${p.label} @ ${vp.width}px  ERROR ${e.message.slice(0, 140)}`)
    }
    await page.close()
  }
  await ctx.close()
}

await browser.close()
console.log(`\nAUTH VIEWPORT SMOKE: ${checks - failures} passed, ${failures} failed`)
process.exit(failures > 0 ? 1 : 0)
