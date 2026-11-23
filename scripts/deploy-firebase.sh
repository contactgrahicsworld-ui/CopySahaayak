#!/bin/bash
# Deploy CopySahaayak to Firebase App Hosting — the SECOND, separate deployment.
# The original Vercel production (https://copysahaayak.vercel.app) is NOT touched:
# this script never calls the Vercel API and Vercel deploys are API-triggered
# (scripts/deploy-sha.sh), so pushing/committing these files changes nothing there.
#
# Usage:
#   bash scripts/deploy-firebase.sh <FIREBASE_PROJECT_ID> [BACKEND_ID] [REGION]
#
# Auth (any one):
#   - .firebase-token file  → CI token from `firebase login:ci` (preferred)
#   - FIREBASE_TOKEN env var
#   - GOOGLE_APPLICATION_CREDENTIALS → path to a service-account JSON key
#
# What it does:
#   1. Creates the App Hosting backend if missing (region us-central1 default)
#   2. Pushes every production env value into Google Secret Manager
#      (mapping defined in apphosting.yaml; values come from .env.vercel-pull)
#   3. `firebase deploy --only apphosting` (local source upload + build + rollout)
#   4. Smoke-tests /api/health on the new backend URL
#
# NOTE: the Firebase deployment shares the SAME Supabase Postgres database as
# Vercel production — same data, live mirror. Alag DB chahiye to pehle batao.
set -euo pipefail
cd /home/z/my-project

PROJECT_ID="${1:-${FIREBASE_PROJECT_ID:-}}"
BACKEND_ID="${2:-${FIREBASE_BACKEND_ID:-copysahaayak}}"
REGION="${3:-${FIREBASE_REGION:-us-central1}}"
ENV_SRC="${ENV_SRC:-.env.vercel-pull}"

if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: Firebase project ID do — bash scripts/deploy-firebase.sh <PROJECT_ID>"
  exit 1
fi
if [ ! -f "$ENV_SRC" ]; then
  echo "ERROR: $ENV_SRC nahi mila — pehle 'npx vercel env pull $ENV_SRC --environment=production' chalao"
  exit 1
fi

export FIREBASE_TOKEN="${FIREBASE_TOKEN:-$(cat .firebase-token 2>/dev/null || true)}"
if [ -z "${FIREBASE_TOKEN}" ] && [ -z "${GOOGLE_APPLICATION_CREDENTIALS:-}" ]; then
  echo "ERROR: Firebase auth missing — 'firebase login:ci' ka token .firebase-token file mein daalo"
  exit 1
fi

FB() { npx --yes firebase-tools@latest "$@"; }

echo "==> Firebase project: $PROJECT_ID | backend: $BACKEND_ID | region: $REGION"

# ---- 1) Backend (create on first run) ---------------------------------------
if ! FB apphosting:backends:describe "$BACKEND_ID" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  echo "==> Backend '$BACKEND_ID' exist nahi karta — banate hain..."
  FB apphosting:backends:create "$BACKEND_ID" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    || {
      echo "ERROR: backend create via CLI fail hua (GitHub-link prompt aa sakta hai)."
      echo "Fallback: Firebase Console → App Hosting → Create backend (ID: $BACKEND_ID, region: $REGION) —"
      echo "GitHub link SKIP karo, phir ye script dobara chalao (deploy local source se hoga)."
      exit 1
    }
fi

# ---- 2) Secrets: production env → Google Secret Manager ----------------------
echo "==> Secrets sync kar rahe hain ($ENV_SRC → Secret Manager)..."
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
# Pairs of (variable, secret) straight from apphosting.yaml.
PAIRS=$(awk '
  /variable:/ { k=$2 }
  /secret:/   { print k" "$2 }
' apphosting.yaml)

SYNCED=0
while read -r KEY SECRET_ID; do
  [ -z "$KEY" ] && continue
  VAL=$(grep -E "^${KEY}=" "$ENV_SRC" | head -1 | cut -d= -f2- || true)
  if [ -z "$VAL" ]; then
    echo "   SKIP $KEY (env pull mein value nahi)"
    continue
  fi
  # strip matching outer quotes if the vercel pull quoted the value
  case "$VAL" in
    \"*\") VAL="${VAL#\"}"; VAL="${VAL%\"}" ;;
    \'*\') VAL="${VAL#\'}"; VAL="${VAL%\'}" ;;
  esac
  printf '%s' "$VAL" > "$TMP"
  if FB apphosting:secrets:set "$SECRET_ID" --project "$PROJECT_ID" --location "$REGION" \
       --data-file "$TMP" --force >/dev/null 2>&1; then
    echo "   OK   $KEY → $SECRET_ID"
    SYNCED=$((SYNCED+1))
  else
    echo "   FAIL $KEY → $SECRET_ID (secret set nahi hua)"
    exit 1
  fi
done <<< "$PAIRS"
echo "==> $SYNCED secrets synced."

# ---- 3) Deploy local source --------------------------------------------------
echo "==> Deploy (local source → App Hosting)..."
FB deploy --only apphosting --project "$PROJECT_ID"

# ---- 4) Smoke test -----------------------------------------------------------
URL=$(FB apphosting:backends:describe "$BACKEND_ID" --project "$PROJECT_ID" --location "$REGION" \
  2>/dev/null | python3 -c "
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw[raw.index('{'):])
    print(d.get('url') or (d.get('domains') or [''])[0])
except Exception:
    print('')
")
if [ -n "$URL" ]; then
  echo "==> Backend URL: $URL"
  echo "==> Smoke test /api/health ..."
  sleep 20
  curl -s "$URL/api/health" || echo "(health check abhi warm-up pe fail hua sakta hai — 1-2 min baad dobara try karo)"
else
  echo "==> URL parse nahi hua — Firebase Console → App Hosting → $BACKEND_ID me URL dekho."
fi
echo "==> DONE. Original Vercel deploy untouched: https://copysahaayak.vercel.app"
