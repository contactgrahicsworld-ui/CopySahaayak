#!/bin/bash
# Usage: bash scripts/run-regression-10x.sh <startRun> <endRun>
# Production E2E regression in chunks (sandbox-safe: sync, per-call).
cd /home/z/my-project
set -a; source .env 2>/dev/null; set +a
# E2E is API-only against the live site — never let a local file: DB leak in.
unset DATABASE_URL DIRECT_URL
BASE_URL="${BASE_URL:-https://copysahaayak.vercel.app}"
export BASE_URL
# Credentials come from the environment — never stored in this repo.
: "${E2E_SUPER_EMAIL:?set E2E_SUPER_EMAIL first}" 
: "${E2E_SUPER_PASSWORD:?set E2E_SUPER_PASSWORD first}"

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
  bash scripts/prod-e2e-cleanup-api.sh > "$LOGDIR/cleanup-$i.log" 2>&1 || echo "cleanup warning run $i"
done
echo "=== CHUNK $START-$END done $(date -u +%H:%M:%S) ==="
