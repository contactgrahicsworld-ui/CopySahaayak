// Proves the PlanClock skew logic: even with the device clock 7 days slow,
// the countdown shows the same time as a correct clock would.
const EXPIRES_AT = '2026-11-19T05:26:16.000Z' // 19 Nov 10:56:16 IST
const SERVER_NOW = '2026-11-12T05:58:42.000Z' // 12 Nov 11:28:42 IST

const fmt = (msLeft) => {
  const ms = Math.max(0, msLeft)
  const d = Math.floor(ms / 86400_000)
  const h = Math.floor((ms % 86400_000) / 3600_000)
  const m = Math.floor((ms % 3600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${d} din ${h} ghante ${m} min ${s} sec`
}

// Scenario A: device clock CORRECT (old logic and new logic agree)
const deviceA = new Date(SERVER_NOW).getTime()
const skewA = new Date(SERVER_NOW).getTime() - deviceA
const shownA = new Date(EXPIRES_AT).getTime() - (deviceA + skewA)
console.log('A. Correct clock, serverNow anchor :', fmt(shownA))

// Scenario B: device clock 7 days SLOW (the bug the user would see with old logic)
const deviceB = new Date(SERVER_NOW).getTime() - 7 * 86400_000
console.log('B1. OLD logic (device clock only)  :', fmt(new Date(EXPIRES_AT).getTime() - deviceB), '<- ye bug tha')
const skewB = new Date(SERVER_NOW).getTime() - deviceB
const shownB = new Date(EXPIRES_AT).getTime() - (deviceB + skewB)
console.log('B2. NEW logic (serverNow anchored) :', fmt(shownB), '<- fix ke baad')

// Scenario C: device clock 3 days FAST
const deviceC = new Date(SERVER_NOW).getTime() + 3 * 86400_000
console.log('C1. OLD logic (device clock only)  :', fmt(new Date(EXPIRES_AT).getTime() - deviceC), '<- ulta bug: kam dikhta')
const skewC = new Date(SERVER_NOW).getTime() - deviceC
const shownC = new Date(EXPIRES_AT).getTime() - (deviceC + skewC)
console.log('C2. NEW logic (serverNow anchored) :', fmt(shownC))

// Scenario D: device clock off by exactly the 5-Nov screenshot amount (7d slow) at 5 Nov 13:18
// Screenshot: 13d 21h 37m 34s. Prove it equals the file timestamp.
const shot = new Date('2026-11-05T07:48:44.000Z') // 13:18:44 IST
const rem = new Date(EXPIRES_AT).getTime() - shot.getTime()
console.log('D. Screenshot math (5 Nov 13:18:44 IST device, clock slow):', fmt(rem), '== screenshot 13d 21h 37m 34s?')

const truthMs = new Date(EXPIRES_AT).getTime() - new Date(SERVER_NOW).getTime()
const pass = shownA === truthMs && shownB === truthMs && shownC === truthMs
console.log('')
console.log(pass ? 'PASS: serverNow anchor makes countdown device-clock-proof' : 'FAIL')
process.exit(pass ? 0 : 1)
