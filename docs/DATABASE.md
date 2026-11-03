# Database Schema (ERD)

Prisma schema: [`prisma/schema.prisma`](../prisma/schema.prisma) — 24 tables, FKs with
cascade rules, unique constraints and indexes on every tenant key (`shopId`, status, dates).
SQLite in the sandbox; PostgreSQL in production (`docker-compose.yml`).

```mermaid
erDiagram
    Shop ||--o{ ShopMember : has
    Shop ||--o| Subscription : "current plan"
    Shop ||--o{ Order : owns
    Shop ||--o{ Document : owns
    Shop ||--o{ PricingRule : "rates per size/colour"
    Shop ||--o{ Device : "Windows connectors"
    Shop ||--o{ Printer : "registered by devices"
    Shop ||--o{ RoutingRule : "colour/size → printer"
    Shop ||--o{ SubscriptionPayment : "plan fees"
    Shop ||--o{ AuditLog : records
    User ||--o{ Session : "opaque hashed tokens"
    User ||--o{ ShopMember : "role OWNER/STAFF"
    Subscription }o--|| Plan : "FREE/STARTER/PRO/ENTERPRISE"
    SubscriptionPayment }o--|| Plan : pays-for
    CustomerSession ||--o{ Order : "guest (no signup)"
    CustomerSession ||--o{ Document : uploads
    Order ||--|{ OrderItem : "document + options"
    Order ||--o| Payment : "UPI, exact amount"
    Payment ||--o{ PaymentVerification : "SUBMIT/VERIFY/REJECT trail"
    OrderItem ||--o{ PrintJob : "fan-out on verify"
    Document ||--o{ PrintJob : "downloaded via signed URL"
    Printer ||--o{ PrintJob : "routed target"
    Device ||--o{ Printer : registers
    Device ||--o{ PrintJob : claims (lease)
    PrintJob ||--o{ PrintEvent : "SPOOLING/COMPLETED/FAILED log"
    OrderItem }o--|| Document : prints
```

## Table reference (grouped)

| Group | Tables |
| --- | --- |
| Platform | `PlatformSetting`, `Plan` (FREE/STARTER/PROFESSIONAL/ENTERPRISE with price, duration, quotas) |
| Identity | `User` (SUPER_ADMIN / SHOP_ADMIN / SHOP_STAFF), `Session` (sha256 token hashes, revocable), `ShopMember` |
| Tenant | `Shop` (slug → public URL, UPI VPA, logo, active flag) |
| Billing | `Subscription`, `SubscriptionPayment` (UTR → Super Admin verify) |
| Catalog | `PricingRule` (shop, paperSize, colorMode → singleSidedPaise / duplexPaise) |
| Customer | `CustomerSession` (registration-free guests, per-shop cookies) |
| Orders | `Order`, `OrderItem` (server-verified pageCount + prices snapshotted), `Document` (private path, sha256, magic-verified MIME) |
| Payments | `Payment` (QR payload snapshot, UTR, status machine), `PaymentVerification` (append-only) |
| Printing | `Device` (pairing codes, token hash, revocation), `Printer` (windowsName unique per shop, colour tag, online state), `RoutingRule`, `PrintJob` (lease, attempts, `spoolDocumentName` unique), `PrintEvent` |
| Observability | `AuditLog` (actor USER/DEVICE/CUSTOMER/SYSTEM), `Notification` (SHOP/SUPER) |

## Money handling

All amounts are **integer paise** end-to-end (`totalPaise`, `unitPricePaise`) — no floats.
Price formula, computed only server-side:

```
sides = clamp(pageFrom..pageTo)  (server-verified page count from pdf-lib)
unit  = duplex ? PricingRule.duplexPaise : PricingRule.singleSidedPaise
total = unit × sides × copies
```

## Migrations & safety

- Dev: `bun run db:push`. Prod: `prisma migrate deploy` (generate a migration baseline with `prisma migrate diff`).
- Order creation, UTR submission, verification, and print-job state changes are wrapped in `db.$transaction`.
- RLS hardening for PostgreSQL: [`prisma/sql/rls-postgres.sql`](../prisma/sql/rls-postgres.sql).
