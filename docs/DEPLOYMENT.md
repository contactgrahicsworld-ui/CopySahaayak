# Deployment, Backup & Recovery — and true running costs

## 1. One-command production bring-up (any Ubuntu/Debian VPS)

```bash
git clone <your-repo> && cd copysahaayak
cp .env.example .env      # set DOMAIN, POSTGRES_PASSWORD, APP_SECRET
docker compose up -d --build
docker compose exec app bunx prisma migrate deploy   # once migrations exist
# seed the super admin + plans once:
docker compose exec app bun prisma/seed.ts
```

Caddy automatically issues **free Let's Encrypt HTTPS** for `$DOMAIN`.

Copy the connector installer to the storage volume so shops can download it:

```bash
docker cp download/connector/PhotocopyShopConnector-Setup.exe \
  $(docker compose ps -q app):/app/private-data/connector/
```

## 2. Health & monitoring

- `GET /api/health` — DB check + secret-configured flag (used by Docker HEALTHCHECK).
- Super Admin → Overview shows devices online, storage used, pending verifications.
- Caddy access logs; `docker compose logs -f app`.

## 3. Backups

- **Database**: nightly `pg_dump -Fc` via `scripts/backup-db.sh` (14-day retention).
  Cron on the host: `15 2 * * * /opt/copysahaayak/scripts/backup-db.sh`
- **Documents**: the `app-data` volume (`/app/private-data`) — snapshot or rsync:
  `rsync -a /var/lib/docker/volumes/copysahaayak_app-data/ /backups/files/`

### Recovery drill

```bash
# DB restore
pg_restore -h 127.0.0.1 -U pcs -d copysahaayak --clean --if-exists db-<stamp>.dump
# Files restore
rsync -a /backups/files/ /var/lib/docker/volumes/copysahaayak_app-data/_data/
docker compose restart app
```

RPO 24 h (nightly dump) / RTO ≈ 15 min (compose up + restore). For 1 h RPO, run the
backup script hourly or enable WAL archiving.

## 4. Updates & rollback

```bash
docker compose build app && docker compose up -d app      # deploy
docker image ls | head                                    # previous image kept
docker compose down && docker compose up -d --no-deps app # pin previous tag to roll back
```

Schema changes: always `prisma migrate deploy` (forward-only); test on staging first.

## 5. True operating cost (zero mandatory paid services)

| Item | Cost |
| --- | --- |
| Software licences | **₹0** — Next.js/React/Prisma (MIT), .NET (MIT), pdfium via PDFtoImage (MIT), NSIS (zlib), Caddy (Apache-2), PostgreSQL (PostgreSQL licence) |
| Payment handling | **₹0 gateway** — money goes shop-bank→customer-bank over UPI (NPCI rails are free for customers; banks may charge the shop per their own UPI terms, outside this platform) |
| SMS / WhatsApp / Email | **₹0** — order status is via the live tracking page + shop phone calls; no paid API dependency |
| AI | **₹0** — no AI APIs used anywhere |
| VPS (2 vCPU / 4 GB / 50 GB) | ≈ ₹400–700/month (e.g. Hetzner CX22 ≈ $4, Indian VPS vendors similar) — the **only** unavoidable cost |
| Domain | ≈ ₹800/year (.in) |
| HTTPS certificates | **₹0** — Let's Encrypt via Caddy |
| Windows connector distribution | **₹0** — served from your own deployment / GitHub Releases (free) |
| Optional: code signing cert | ~$70–400/yr to remove SmartScreen warnings — **optional**, not required |

**Minimum sustainable run-rate ≈ ₹500–700/month total (VPS + domain).**

## 6. Scaling path

- Single VPS comfortably serves dozens of shops (file workloads are small PDFs).
- >1 app replica: move rate limiting to Redis, put Postgres on managed storage, keep
  `/private-data` on shared storage (or swap to S3-compatible MinIO, self-hosted).
