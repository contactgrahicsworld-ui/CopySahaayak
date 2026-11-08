#!/usr/bin/env bash
# ONE-COMMAND production finisher:
#   1. Set SUPER_SETUP_RESET_KEY on Vercel (encrypted) — the break-glass recovery key
#   2. Deploy the current commit to production (repo is GitHub-connected)
#   3. Verify the new build is live (/api/setup returns recoveryRequired)
#   4. Break-glass reset: delete ALL old super admin credentials, clear stale UPI
#   5. Create the FRESH Super Admin through the creation-page flow (claim token)
#   6. Verify the fresh super can sign in; print everything to save
#
# Usage:
#   VCL_TOKEN=<vercel-token> bash scripts/deploy-and-fresh-super.sh
# Optional:
#   SUPER_EMAIL / SUPER_PASSWORD / SUPER_NAME / SUPER_PHONE / SUPER_UPI / SUPER_PAYEE
#   (if SUPER_EMAIL is omitted, the previous super's email is reused when readable;
#    otherwise super@copysahaayak.local is used and MUST be changed from the dashboard)
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN="${VCL_TOKEN:?set VCL_TOKEN=<vercel-token>}"
TEAM="team_kjzlL9oti3ciMWtCz2ye5IHy"
PROJ="prj_DvUIS0wkM6pqy0nrRJDLgyWLzDZw"
REPO_ID=1442824032
BASE="${PROD_BASE:-https://copysahaayak.vercel.app}"
SHA="$(git rev-parse HEAD)"

echo "=== 1. Set SUPER_SETUP_RESET_KEY on Vercel (production) ==="
RESET_KEY="${SUPER_SETUP_RESET_KEY:-bk-$(openssl rand -hex 16)}"
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
echo "deployment: $DPL — polling (db push runs inside the build)..."
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
LIVE=""
for i in $(seq 1 15); do
  R=$(curl -s "$BASE/api/setup")
  if echo "$R" | grep -q recoveryRequired; then LIVE=1; echo "new build live: $R"; break; fi
  sleep 10
done
[[ -n "$LIVE" ]] || { echo "FATAL: new build not detected at $BASE"; exit 1; }

echo "=== 4. Break-glass reset — old super credentials removed ==="
RESET=$(curl -s -X POST "$BASE/api/setup/reset" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"resetKey\":\"${RESET_KEY}\"}")
echo "$RESET" | python3 -c "import json,sys;d=json.load(sys.stdin);print('removed old supers:', d.get('removedSupers', d))" || { echo "RESET FAILED: $RESET"; exit 1; }
CLAIM=$(echo "$RESET" | python3 -c "import json,sys;print(json.load(sys.stdin).get('claimToken',''))")
[[ -n "$CLAIM" ]] || { echo "FATAL: no claim token: $RESET"; exit 1; }

echo "=== 5. Create the fresh Super Admin via the creation-page flow ==="
SUPER_EMAIL="${SUPER_EMAIL:-}"
SUPER_PASSWORD="${SUPER_PASSWORD:-PcsSuper#$(openssl rand -hex 4)9A}"
SUPER_NAME="${SUPER_NAME:-Platform Owner}"
SUPER_PHONE="${SUPER_PHONE:-}"
SUPER_UPI="${SUPER_UPI:-}"
SUPER_PAYEE="${SUPER_PAYEE:-}"
if [[ -z "$SUPER_EMAIL" ]]; then
  # Reuse the previous super's email when the decrypted env lets us see it.
  VCL_TOKEN="$TOKEN" node scripts/fetch-vercel-env.mjs >/dev/null 2>&1 || true
  OLD_EMAIL=$(node -e "
    try {
      const fs=require('fs'),pg=require('pg');
      const txt=fs.readFileSync('/tmp/vercel-env.txt','utf8');
      const get=k=>(txt.match(new RegExp('^'+k+'=\"?(.*?)\"?\$','m'))||[])[1]||'';
      const url=get('DIRECT_URL')||get('DATABASE_URL');
      if(!url || url.startsWith('eyJ')) process.exit(0);
      const c=new pg.Client({connectionString:url,ssl:{rejectUnauthorized:false}});
      c.connect().then(()=>c.query(\"SELECT email FROM csp.\\\"User\\\" WHERE role='SUPER_ADMIN' ORDER BY \\\"createdAt\\\" DESC LIMIT 1\"))
        .then(r=>{if(r.rows[0])console.log(r.rows[0].email);return c.end()}).catch(()=>process.exit(0));
    } catch(e) { process.exit(0); }")
  if [[ -n "$OLD_EMAIL" ]]; then SUPER_EMAIL="$OLD_EMAIL"; echo "(reusing previous super email: $OLD_EMAIL)"; else SUPER_EMAIL="super@copysahaayak.local"; echo "WARNING: could not read previous email — placeholder used, CHANGE IT after first login"; fi
fi

CREATE=$(curl -s -X POST "$BASE/api/setup" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"name\":\"${SUPER_NAME}\",\"email\":\"${SUPER_EMAIL}\",\"password\":\"${SUPER_PASSWORD}\"$( [[ -n "$SUPER_PHONE" ]] && printf ',"phone":"%s"' "$SUPER_PHONE" )$( [[ -n "$SUPER_UPI" ]] && printf ',"upiVpa":"%s"' "$SUPER_UPI" )$( [[ -n "$SUPER_PAYEE" ]] && printf ',"upiPayeeName":"%s"' "$SUPER_PAYEE" )$( [[ -n "$CLAIM" ]] && printf ',"claimToken":"%s"' "$CLAIM" )}")
echo "$CREATE" | grep -q '"ok":true' || { echo "CREATE FAILED: $CREATE"; exit 1; }
echo "fresh super created on $BASE"

echo "=== 6. Verify sign-in ==="
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"email\":\"${SUPER_EMAIL}\",\"password\":\"${SUPER_PASSWORD}\"}")
echo "$LOGIN" | grep -q '"role":"SUPER_ADMIN"' || { echo "LOGIN VERIFY FAILED: $LOGIN"; exit 1; }
DONE=$(curl -s "$BASE/api/setup")
echo "final setup state: $DONE"

echo ""
echo "================ SAVE THIS ================"
echo "Super Admin URL : $BASE/super/login"
echo "Email           : $SUPER_EMAIL"
echo "Password        : $SUPER_PASSWORD"
echo "Recovery key    : $RESET_KEY   (store safely — needed at $BASE/setup if credentials are ever lost)"
echo "Dashboard       : $BASE/super"
echo "==========================================="
