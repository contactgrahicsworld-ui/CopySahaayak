#!/usr/bin/env bash
# Exchange the saved Vercel device_code for an access token (run AFTER user approves).
# Reads /home/z/my-project/.device-code, writes token to /home/z/my-project/.vercel-token
# and CLI auth.json (for post-login-deploy.sh compatibility).
set -euo pipefail
DC_FILE=/home/z/my-project/.device-code
DC=$(tr -d '[:space:]' < "$DC_FILE")
CLIENT_ID="cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp"
R=$(curl -s -X POST https://api.vercel.com/login/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=${CLIENT_ID}&device_code=${DC}")
if ! echo "$R" | grep -q '"access_token"'; then
  echo "EXCHANGE FAILED: $R"
  exit 1
fi
TOKEN=$(echo "$R" | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
echo "$TOKEN" > /home/z/my-project/.vercel-token
chmod 600 /home/z/my-project/.vercel-token
mkdir -p ~/.local/share/com.vercel.cli
python3 - "$TOKEN" <<'EOF'
import json, os, sys
tok = sys.argv[1]
ap = os.path.expanduser('~/.local/share/com.vercel.cli/auth.json')
json.dump({'token': tok, 'teamId': 'team_kjzlL9oti3ciMWtCz2ye5IHy'}, open(ap, 'w'))
os.chmod(ap, 0o600)
EOF
echo "TOKEN SAVED (len ${#TOKEN})"
echo "verify: $(curl -s -o /dev/null -w '%{http_code}' https://api.vercel.com/v2/user -H "Authorization: Bearer $TOKEN") (200=valid)"
