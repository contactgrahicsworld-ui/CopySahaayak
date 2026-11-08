#!/usr/bin/env bash
# Polls the Vercel OAuth device-flow token endpoint until the user approves.
# On success: writes the token to /tmp/vcl-token (600) + CLI auth.json, prints OK.
set -euo pipefail
DC_FILE="/tmp/vercel-device-code.json"
OUT="/tmp/vcl-token"
[[ -f "$DC_FILE" ]] || { echo "no device code file"; exit 1; }
DC=$(python3 -c "import json;print(json.load(open('$DC_FILE'))['device_code'])")
CLIENT_ID="cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp"
for i in $(seq 1 60); do
  RESP=$(curl -s -X POST https://api.vercel.com/login/oauth/token \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=${CLIENT_ID}&device_code=${DC}")
  # pending → keep polling; success → save; error → show
  if echo "$RESP" | grep -q '"access_token"'; then
    echo "$RESP" | python3 -c "
import json,sys,os
d=json.load(sys.stdin)
tok=d.get('access_token')
open('/tmp/vcl-token','w').write(tok+'\n')
os.chmod('/tmp/vcl-token',0o600)
os.makedirs(os.path.expanduser('~/.local/share/com.vercel.cli'),exist_ok=True)
ap=os.path.expanduser('~/.local/share/com.vercel.cli/auth.json')
json.dump({'token':tok,'refreshToken':d.get('refresh_token',''),'teamId':'team_kjzlL9oti3ciMWtCz2ye5IHy'},open(ap,'w'))
print('TOKEN SAVED (len',str(len(tok))+')')
"
    exit 0
  fi
  ERR=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('error',''))" 2>/dev/null || echo "")
  case "$ERR" in
    authorization_pending) sleep 5 ;;
    slow_down) sleep 8 ;;
    expired_token) echo "DEVICE CODE EXPIRED — issue a new one"; exit 2 ;;
    *) echo "unexpected: $RESP"; sleep 5 ;;
  esac
done
echo "poll window ended without approval"
exit 3
