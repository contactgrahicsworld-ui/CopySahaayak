# System Architecture

## Context

```mermaid
flowchart LR
    C[Customer phone<br/>no app, no signup] -->|scan QR /s/slug| W
    O[Shop owner<br/>browser] -->|/admin| W
    S[Platform Super Admin] -->|/super| W
    W[Next.js 16 SaaS<br/>API + UI + Prisma] --> DB[(PostgreSQL<br/>prod / SQLite dev)]
    W --> FS[(Private file storage<br/>/private-data, signed URLs)]
    D[Windows connector<br/>C# .NET 8 tray app] -->|pair / heartbeat<br/>claim / events| W
    D --> PRN1[B/W printer]
    D --> PRN2[Colour printer]
    CU[Customer UPI app] -->|pays exact amount| SHOP[(Shop UPI account)]
    SU[Shop UPI app] -->|plan fee| PLAT[(Platform UPI account)]
```

Payment never touches the platform's servers — the UPI QR encodes the **shop's own VPA**
with the exact amount, so money moves bank-to-bank. The platform only records references
(UTR) and verification decisions, keeping the system payment-gateway-free and commission-free.

## Order lifecycle (state machine)

```mermaid
stateDiagram-v2
    [*] --> PENDING_PAYMENT: server prices items, UPI QR generated
    PENDING_PAYMENT --> AWAITING_VERIFICATION: customer submits UTR
    PENDING_PAYMENT --> CANCELLED: timeout / customer / shop
    AWAITING_VERIFICATION --> CONFIRMED: shop verifies UTR → print jobs QUEUED
    AWAITING_VERIFICATION --> REJECTED: UTR mismatch
    CONFIRMED --> COMPLETED: every print job COMPLETED (spooler-verified)
    CONFIRMED --> CANCELLED: shop cancels
```

Print job states: `QUEUED → CLAIMED (10-min lease) → SPOOLING → COMPLETED | FAILED`
(auto-requeue while `attempts < maxAttempts`; manual requeue by shop).

## Print job flow

```mermaid
sequenceDiagram
    participant O as Order (CONFIRMED)
    participant A as SaaS API
    participant D as Windows connector
    participant W as Windows spooler
    A->>A: enqueuePrintJobs() — colour/size routing rules
    D->>A: heartbeat every ~20 s (printer inventory upsert)
    D->>A: POST /api/device/jobs/claim
    A-->>D: job + 30-min signed download URL (10-min lease taken)
    D->>A: GET signed URL → stores temp file
    D->>D: PDF rasterised (pdfium, 220 DPI) / image loaded
    D->>D: B/W → GDI+ grayscale, duplex/copies/paper set on PrintDocument
    D->>W: Print() with DocumentName = "PCS-<order>-<item>"
    D->>A: event SPOOLING
    D->>W: EnumJobs poll — job leaves queue or JOB_STATUS_COMPLETE
    D->>A: event COMPLETED (only now; server rejects COMPLETED w/o SPOOLING)
    A->>A: all jobs done → order COMPLETED
```

## Deployment topology (production)

```mermaid
flowchart TB
    subgraph VPS["Single VPS (docker compose)"]
        CD[Caddy :443<br/>auto-HTTPS] --> APP[App container :3000]
        APP --> PG[(PostgreSQL 16 container<br/>volume + nightly pg_dump)]
        APP --> VOL[(/app/private-data volume<br/>uploads + branding + connector EXE)]
    end
    U[Users] --> CD
    DEV[Shop Windows PC] --> CD
```

Horizontal scale notes: the rate limiter is in-memory per instance — swap for Redis when
running >1 replica (documented in SECURITY.md).
