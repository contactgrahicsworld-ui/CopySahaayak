#!/usr/bin/env bash
# Post-login production deploy: env + deploy + verify (one command once the
# Vercel device-auth token is saved by the CLI).
#   Usage: bash scripts/post-login-deploy.sh
set -euo pipefail
cd /home/z/my-project

TEAM="team_kjzlL9oti3ciMWtCz2ye5IHy"
PROJ="prj_DvUIS0wkM6pqy0nrRJDLgyWLzDZw"
REPO_ID=1442824032
BASE="https://copysahaayak.vercel.app"
SHA="$(git rev-parse HEAD)"
TOKEN="$(python3 -c "
import json, os
p = os.path.expanduser('~/.local/share/com.vercel.cli/auth.json')
d = json.load(open(p))
print(d.get('token') or d.get('accessToken') or '')")"
[[ -n "$TOKEN" ]] || { echo "FATAL: no vercel token in CLI auth.json — device login not completed yet"; exit 1; }
echo "token loaded (len ${#TOKEN})"

echo "=== 1. SUPER_SETUP_RESET_KEY (break-glass recovery secret) ==="
RESET_KEY="bk-$(openssl rand -hex 16)"
UP=$(curl -s -X POST "https://api.vercel.com/v10/projects/${PROJ}/env?teamId=${TEAM}&upsert=true" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"key\":\"SUPER_SETUP_RESET_KEY\",\"value\":\"${RESET_KEY}\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}")
echo "$UP" | python3 -c "import json,sys;d=json.load(sys.stdin);print('env upserted:', d.get('key', d))" || { echo "ENV FAILED: $UP"; exit 1; }
echo "$RESET_KEY" > /tmp/recovery-key.txt && chmod 600 /tmp/recovery-key.txt

echo "=== 2. Deploy ${SHA:0:8} to production ==="
RESP=$(curl -s -X POST "https://api.vercel.com/v13/deployments?teamId=${TEAM}&skipAutoDetectionConfirmation=1" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"name\":\"copysahaayak\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"repoId\":${REPO_ID},\"ref\":\"${SHA}\"}}")
DPL=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
[[ -n "$DPL" ]] || { echo "DEPLOY CREATE FAILED: $RESP"; exit 1; }
echo "deployment: $DPL — polling (schema sync runs inside the build)..."
FINAL=""
for i in $(seq 1 90); do
  sleep 10
  ST=$(curl -s "https://api.vercel.com/v13/deployments/${DPL}?teamId=${TEAM}" \
    -H "Authorization: Bearer ${TOKEN}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('readyState',''))")
  echo "  poll $i: $ST"
  [[ "$ST" == "READY" ]] && { FINAL=READY; break; }
  [[ "$ST" == "ERROR" || "$ST" == "CANCELED" ]] && { echo "DEPLOY FAILED: $ST"; exit 1; }
done
[[ "$FINAL" == "READY" ]] || { echo "TIMEOUT waiting for deploy"; exit 1; }

echo "=== 3. Verify new build live ==="
LIVE=""
for i in $(seq 1 15); do
  R=$(curl -s "$BASE/api/setup")
  echo "$R" | grep -q recoveryRequired && { LIVE=1; echo "new build live: $R"; break; }
  sleep 10
done
[[ -n "$LIVE" ]] || { echo "FATAL: new build not detected"; exit 1; }

echo "=== 4. Feature smoke ==="
S=$(curl -s "$BASE/api/setup"); echo "setup: $S"
T=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/transfer/does-not-exist"); echo "transfer info route: HTTP $T (400/404=live)"
A=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/admin/transfer" -H "Content-Type: application/json" -H "Origin: $BASE" -d '{}'); echo "admin transfer start: HTTP $A (401=auth-guard live)"
echo ""
echo "=================================================="
echo "DEPLOY OK: $SHA"
echo "Recovery key saved at /tmp/recovery-key.txt"
echo "=================================================="
