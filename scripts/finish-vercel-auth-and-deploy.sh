#!/usr/bin/env bash
# One-shot: exchange the pending Vercel device code for a token (issuing a fresh
# code when expired), then deploy the current HEAD to production.
# Exit codes: 0 = deployed; 6 = user has not approved yet; 7 = NEW code issued (tell user).
set -uo pipefail
cd /home/z/my-project
CLIENT_ID="cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp"
PENDING=/home/z/my-project/.device-code-pending

issue_new() {
  local RESP
  RESP=$(curl -s -X POST "https://api.vercel.com/login/oauth/device-authorization" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=${CLIENT_ID}")
  echo "$RESP" > "$PENDING"
  python3 - "$RESP" <<'EOF'
import json, sys
d = json.loads(sys.argv[1])
print("NEW_CODE_NEEDED")
print("URL: " + str(d.get('verification_uri')))
print("CODE: " + str(d.get('user_code')))
EOF
  exit 7
}

[ -f "$PENDING" ] || issue_new
DC=$(python3 -c "import json;print(json.load(open('$PENDING'))['device_code'])" 2>/dev/null) || issue_new

RESP=$(curl -s -X POST https://api.vercel.com/login/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=${CLIENT_ID}&device_code=${DC}")

if echo "$RESP" | grep -q '"access_token"'; then
  echo "$RESP" | python3 -c "
import json, sys, os
d = json.load(sys.stdin)
tok = d['access_token']
open('/home/z/my-project/.vercel-token', 'w').write(tok)
os.chmod('/home/z/my-project/.vercel-token', 0o600)
print('TOKEN OK (len ' + str(len(tok)) + ')')
"
else
  ERR=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "?")
  case "$ERR" in
    authorization_pending) echo "PENDING — user has not approved yet"; exit 6 ;;
    expired_token|slow_down) issue_new ;;
    *) echo "unexpected error: $ERR"; issue_new ;;
  esac
fi

SHA=$(git rev-parse HEAD)
echo "Deploying $SHA ..."
bash scripts/deploy-sha.sh "$SHA"
