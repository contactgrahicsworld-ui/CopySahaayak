#!/bin/bash
# Usage: bash scripts/run-regression-10x.sh <startRun> <endRun>
# Production E2E regression in chunks (sandbox-safe: sync, per-call).
cd /home/z/my-project
unset DATABASE_URL DIRECT_URL
set -a; source .env; set +a
BASE_URL="${BASE_URL:-https://copysahaayak.vercel.app}"
export BASE_URL
export E2E_SUPER_EMAIL="vedpackagingindustries@gmail.com"
export E2E_SUPER_PASSWORD="Cs-Super-gTmYb70V3eKd"

START=${1:-1}
END=${2:-10}
SB_IP="8.212.10.159"
LOGDIR="/home/z/my-project/.regression"
mkdir -p "$LOGDIR"

for i in $(seq "$START" "$END"); do
  echo "=== RUN $i start $(date -u +%H:%M:%S) ==="
  bun scripts/clear-rl.mjs "$SB_IP" 2>&1 | head -1
  if bun tests/e2e-api.mjs > "$LOGDIR/e2e-run-$i.log" 2>&1; then
    echo "RUN $i: PASS"
  else
    echo "RUN $i: FAIL"
    echo "--- last 25 lines ---"
    tail -25 "$LOGDIR/e2e-run-$i.log"
  fi
  bun scripts/prod-e2e-cleanup.mjs > "$LOGDIR/cleanup-$i.log" 2>&1 || echo "cleanup warning run $i"
done
echo "=== CHUNK $START-$END done $(date -u +%H:%M:%S) ==="
