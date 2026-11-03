// Validates: cron reminder endpoint (with secret) + xlsx export structure.
import 'dotenv/config'
const BASE = 'http://localhost:3000'

// 1. Cron with secret
const cronRes = await fetch(`${BASE}/api/cron/plan-reminders?secret=${process.env.APP_SECRET}`)
const cronData = await cronRes.json().catch(() => null)
console.log('cron with secret:', cronRes.status, JSON.stringify(cronData)?.slice(0, 200))

// 2. Login once
let cookie = ''
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: BASE },
  body: JSON.stringify({ email: 'owner.a.ysqes1@testshop-test.in', password: 'SuperReset#ysqes17Q' }),
})
console.log('login:', login.status)
const sc = login.headers.getSetCookie?.() || []
cookie = sc.map((c) => c.split(';')[0]).join('; ')

// 3. Download xlsx for each grouping
const ExcelJS = (await import('/home/z/my-project/node_modules/exceljs/lib/exceljs.nodejs.js')).default
for (const gb of ['day', 'week', 'month']) {
  const res = await fetch(`${BASE}/api/admin/reports/export?days=30&groupBy=${gb}`, { headers: { Cookie: cookie } })
  const buf = Buffer.from(await res.arrayBuffer())
  const ok = buf[0] === 0x50 && buf[1] === 0x4b
  console.log(`export ${gb}:`, res.status, buf.length + 'B', ok ? 'PK-OK' : 'INVALID', '|', res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1])
  if (ok && gb === 'month') {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    for (const ws of wb.worksheets) {
      console.log(`  sheet "${ws.name}": ${ws.rowCount} rows | headers:`, ws.getRow(1).values.slice(1, 6).join(', '))
    }
  }
}
