# CopySahaayak — Photocopy Shop Automation SaaS

Multi-tenant SaaS for Indian photocopy shops: customers scan the shop's QR, upload
PDFs/images, configure print options and pay by UPI (dynamic QR with the exact amount,
UTR verified manually by the shop). Verified jobs are printed automatically by a Windows
desktop connector. **No payment gateway. No commission. No mandatory paid APIs.**

## Quick start (sandbox/dev)

```bash
bun install
bun run db:push && bun prisma/seed.ts
bun run dev        # http://localhost:3000
```

## Accounts

| Role | URL | Credentials |
| --- | --- | --- |
| Super Admin (platform owner) | `/super` | **No default.** Created once via first-run `/setup` — the setup page locks permanently afterwards. |
| Shop Admin | `/admin` | Shop owner creates their own account at `/register`. |
| Customer | `/s/{slug}` | no account needed |

The repo and the deployed app ship with **zero predefined or hardcoded credentials**.
`prisma/seed.ts` creates only platform settings + plans — never users.

## Surfaces

| Surface | Route | Purpose |
| --- | --- | --- |
| Landing | `/` | product overview |
| Customer ordering | `/s/{shop-slug}` | mobile-first upload → configure → UPI → track |
| Order tracking | `/s/{slug}/order/{orderNumber}` | live status, auto-refresh |
| Shop Admin | `/admin` | orders, payment verification, printers/devices, pricing, reports, settings |
| Super Admin | `/super` | shops, subscriptions, plans, analytics, audit, platform settings |
| Connector download | `/download` → `/api/downloads/connector` | Windows installer EXE |

## Windows connector

`PhotocopyShopConnector-Setup.exe` (NSIS installer, self-contained .NET 8, unsigned) —
source in `connector/`, build with `scripts/build-connector.sh`, CI rebuild via
`.github/workflows/build-connector.yml`. Install guide: `connector/README.md`.
A job is marked COMPLETED **only after the Windows print spooler confirms it** — the
server rejects COMPLETED events without a prior SPOOLING event (tested).

## Tests

```bash
bun test tests/unit.test.mjs     # 15 unit tests (pricing, UPI, signatures, magic bytes)
node tests/e2e-api.mjs           # 52 E2E + security tests incl. cross-tenant attacks
bun run lint && bunx tsc --noEmit
```

## Architecture & docs

- `docs/ARCHITECTURE.md` — system + data-flow diagrams (Mermaid)
- `docs/DATABASE.md` — ERD and table reference
- `docs/SECURITY.md` — threat model, tenant isolation, controls
- `docs/PRINTER-INTEGRATION.md` — connector protocol, spooler verification
- `docs/DEPLOYMENT.md` — production deployment, backups, recovery, costs

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Prisma (SQLite dev / PostgreSQL prod) ·
Tailwind 4 + shadcn/ui · qrcode (UPI QR) · pdf-lib (server page counts) · bcryptjs ·
C# .NET 8 WinForms + PDFtoImage (MIT) + Windows spooler (winspool.drv) · NSIS installer.

All dependencies are permissively licensed (MIT/Apache-2.0/BSD) — commercial use OK.
