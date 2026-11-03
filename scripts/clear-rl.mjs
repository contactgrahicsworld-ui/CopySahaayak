// Clear app-level rate-limit rows for the sandbox egress IP (test isolation).
import 'dotenv/config'
import pg from 'pg'

const ip = process.argv[2] || '8.212.10.159'
const client = new pg.Client({ connectionString: process.env.DIRECT_URL })
await client.connect()
const r = await client.query(`DELETE FROM csp."RateLimitEntry" WHERE key LIKE $1`, [`%${ip}%`])
console.log(`cleared ${r.rowCount} rate-limit rows for ${ip}`)
await client.end()
