#!/bin/bash
# Runs before `next build`. On Vercel the build environment carries the real
# (decrypted) DATABASE_URL, so schema changes reach production exactly when the
# new code that uses them deploys — no separate manual `db push` step ever.
# Locally the sandbox uses a SQLite file URL (postgresql provider can't push to
# it), so the step is skipped there and next build runs as before.
set -euo pipefail
cd "$(dirname "$0")/.."

case "${DATABASE_URL:-}" in
  postgres*|postgresql*)
    echo "==> prisma db push (additive schema sync)"
    npx prisma db push --accept-data-loss --skip-generate
    ;;
  *)
    echo "==> skipping prisma db push (DATABASE_URL is not postgres — local/preview build)"
    ;;
esac
