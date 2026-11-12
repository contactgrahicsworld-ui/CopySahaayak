#!/usr/bin/env bash
# Production deployer — ZERO predefined credentials.
# The app NEVER ships or generates a Super Admin email/password. The platform
# owner self-creates their account at /setup, typing their own credentials.
#
#   1. Set/refresh SUPER_SETUP_RESET_KEY on Vercel (encrypted env secret)
#   2. Deploy the current commit to production (GitHub-connected build)
#   3. Verify the new build is live
#   4. OPTIONAL break-glass reset (RESET_SUPER=1): deletes ALL existing super
#      admin credentials + sessions so the owner can self-create a fresh one.
#      (Needed only when an old super exists and must be removed.)
#
# The script NEVER creates the super admin account — step 5 of old versions
# (auto-creation with a generated password) was removed by owner request:
# "super admin khud se credential or password bharega, app predefined
#  credential nahi degi".
#
# Usage:
#   VCL_TOKEN=<vercel-token> bash scripts/deploy-and-fresh-super.sh
#   VCL_TOKEN=... RESET_SUPER=1 bash scripts/deploy-and-fresh-super.sh
# Optional:
#   SUPER_SETUP_RESET_KEY=bk-...   (reuse your existing recovery key; one is
#                                   generated only if you don't have one yet)
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN="${VCL_TOKEN:?set VCL_TOKEN=<vercel-token>}"
TEAM="team_kjzlL9oti3ciMWtCz2ye5IHy"
PROJ="prj_DvUIS0wkM6pqy0nrRJDLgyWLzDZw"
REPO_ID=1442824032
BASE="${PROD_BASE:-https://copysahaayak.vercel.app}"
SHA="$(git rev-parse HEAD)"
RESET_KEY="${SUPER_SETUP_RESET_KEY:-bk-$(openssl rand -hex 16)}"

echo "=== 1. Set SUPER_SETUP_RESET_KEY on Vercel (production) ==="
curl -s -X POST "https://api.vercel.com/v10/projects/${PROJ}/env?teamId=${TEAM}&upsert=true" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"key\":\"SUPER_SETUP_RESET_KEY\",\"value\":\"${RESET_KEY}\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('env upserted:', d.get('key', d))"

echo "=== 2. Deploy ${SHA:0:8} to production ==="
RESP=$(curl -s -X POST "https://api.vercel.com/v13/deployments?teamId=${TEAM}&skipAutoDetectionConfirmation=1" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"name\":\"copysahaayak\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"repoId\":${REPO_ID},\"ref\":\"${SHA}\"}}")
DPL=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
[[ -n "$DPL" ]] || { echo "DEPLOY CREATE FAILED: $RESP"; exit 1; }
echo "deployment: $DPL — polling..."
for i in $(seq 1 90); do
  sleep 10
  ST=$(curl -s "https://api.vercel.com/v13/deployments/${DPL}?teamId=${TEAM}" \
    -H "Authorization: Bearer ${TOKEN}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('readyState',''))")
  echo "  poll $i: $ST"
  [[ "$ST" == "READY" ]] && break
  [[ "$ST" == "ERROR" || "$ST" == "CANCELED" ]] && { echo "DEPLOY FAILED: $ST"; exit 1; }
done

echo "=== 3. Verify the new build is live ==="
for i in $(seq 1 15); do
  R=$(curl -s "$BASE/api/setup")
  echo "  /api/setup: $R"
  echo "$R" | grep -q 'setupDone' && break
  sleep 10
done

if [[ "${RESET_SUPER:-0}" == "1" ]]; then
  echo "=== 4. Break-glass reset (RESET_SUPER=1) — old super credentials removed ==="
  RESET=$(curl -s -X POST "$BASE/api/setup/reset" -H "Content-Type: application/json" -H "Origin: $BASE" \
    -d "{\"resetKey\":\"${RESET_KEY}\"}")
  echo "$RESET" | python3 -c "import json,sys;d=json.load(sys.stdin);print('removed old supers:', d.get('removedSupers', d.get('error', d)))"
  echo "Platform is now in self-create mode: /setup unlocks with the recovery key."
fi

echo ""
echo "================ NO PREDEFINED CREDENTIALS ================"
echo "Deployed      : $BASE  (commit ${SHA:0:8})"
echo "Setup page    : $BASE/setup"
echo "Recovery key  : $RESET_KEY   (SAVE THIS — needed at $BASE/setup)"
echo ""
echo "Super Admin KHUD banayega:"
echo "  1. $BASE/setup kholo"
echo "  2. Agar recovery maange → apni recovery key paste karo"
echo "  3. APNA naam, email, password (8+ chars), UPI khud bharo"
echo "  4. Usi email/password se $BASE/super/login par login karo"
echo "Script ya app koi email/password nahi deti — ye sirf owner janta hai."
echo "==========================================================="
