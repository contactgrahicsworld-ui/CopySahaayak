# Security Architecture

## Threat model summary

| Asset | Threat | Control |
| --- | --- | --- |
| Cross-tenant data | Shop A reads/edits Shop B orders, payments, documents, printers | Every admin query filters by `shopId` **derived from the session** (`requireAnyShopAdmin`), never from client input; document IDs re-checked against session/shop; device tokens are shop-scoped. Verified by attack tests in `tests/e2e-api.mjs` §4 |
| Customer privacy | Registration-free guests could see others' orders | Tracking requires the creating guest session cookie **or** the matching phone number; signed preview URLs are HMAC'd, 10-min TTL, bound to document ID |
| Private documents | Direct URL guessing, hotlinking | Files stored **outside the web root**; served only via `/api/files/{id}?exp&sig` (HMAC-SHA256 over `id|exp`, constant-time compare); `nosniff`, `no-store` |
| Malicious uploads | EXE/HTML/PHP disguised as PDF; zip bombs | Magic-byte sniffing (`%PDF-`, JPEG FFD8FF, PNG signature) — declared MIME ignored; pdf-lib re-parse for page count (rejects corrupt files); 25 MB cap; page cap 2000 |
| Credential attacks | Brute force, enumeration | bcrypt (cost 12); identical 401 shape for unknown email vs wrong password; fixed-window rate limits (login 10/15 min, upload 15/10 min, orders 12/10 min, pairing 5/15 min) |
| Session theft | Cookie-based XSS | HttpOnly + SameSite=Lax cookies; tokens stored as sha256 hashes (DB leak ≠ usable sessions); revocable server-side; 30-day expiry |
| CSRF | Cross-site state changes | SameSite=Lax + `Origin` check on all mutating requests (`sameOriginOk`) |
| IDOR | Sequential/enumerable IDs | cuid() identifiers; object ownership checked per request (payment→order→shop chain) |
| Print spoofing | Connector reports success without printing | Server **rejects** `COMPLETED` unless `SPOOLING` was recorded first; job marked complete only from spooler-verified connector events (test §5) |
| Rogue devices | Stolen pairing code/token | Pairing codes: 6-char unambiguous alphabet, single-use, 15-min expiry; device tokens revocable instantly (`REVOKE` releases claimed jobs); shop suspension revokes all devices |
| Payment fraud | Fake UTRs | Manual verification by shop (orders) and Super Admin (subscriptions); UTR format validated; duplicate submission blocked; verification requires UTR present; everything audit-logged |
| Injection | SQLi | Prisma parameterised queries exclusively; no raw string SQL |
| XSS | React output | React escaping; no `dangerouslySetInnerHTML` anywhere |
| Secrets | Leakage in repo | `.env` git-ignored; `APP_SECRET` required in prod (health endpoint flags when unset); no secrets in logs (connector masks tokens) |

## Isolation layers (PostgreSQL production)

1. **Application layer (primary)** — session→shopId scoping in every query.
2. **Row Level Security (defense-in-depth)** — `prisma/sql/rls-postgres.sql` forces
   `shop_id = current_setting('app.current_shop')` on all tenant tables; enable after
   migrations, set per request via a Prisma `$extends` hook.
3. **Edge middleware** — `/admin` & `/super` require a session cookie before page load.

## Audit trail

`AuditLog` records (actor type, actor, shop, action, entity, IP): logins, order create,
UTR submit/verify/reject, pricing changes, profile changes, pairing issue/revoke, print
events, subscription verify, platform setting changes. Viewable in Super Admin → Audit.

## Known limitations (honest disclosure)

- Rate limiting is in-memory: correct for single-instance deployment; use Redis/DB-backed
  limiter when horizontally scaling.
- CSP is not strict-dynamic yet (Next.js inline bootstrap scripts); headers set at the
  reverse proxy (`Caddyfile.prod`).
- The sandbox/preview deployment runs SQLite; RLS applies only on PostgreSQL production.
- No code-signing certificate for the connector installer (disclosed in delivery report).
