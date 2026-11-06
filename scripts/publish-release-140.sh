#!/usr/bin/env bash
# Publishes connector-v1.4.0 to GitHub Releases with both artifacts.
# Token comes from the git remote URL; never printed.
set -euo pipefail
cd /home/z/my-project

GH_TOKEN=$(git remote get-url origin | sed -n 's|https://[^:]*:\([^@]*\)@github.com/.*|\1|p')
[ -n "$GH_TOKEN" ] || { echo "no token"; exit 1; }

TAG="connector-v1.4.0"
SETUP=download/connector/DesktopSahaayak-Setup.exe
PORTABLE=download/connector/DesktopSahaayak-portable.exe
SETUP_SHA=$(sha256sum "$SETUP" | awk '{print $1}')
PORT_SHA=$(sha256sum "$PORTABLE" | awk '{print $1}')

BODY=$(cat <<EOF
Desktop Sahaayak v1.4.0 — Windows print connector

**Fixed in 1.4.0**
- Revoked/removed devices no longer spam 401 retries: the app now parks itself with a clear "Revoked or removed — pair again" message.
- Friendlier server-URL errors, true single-instance guard (no more duplicate tray apps), real PC name shown in the dashboard.

**Files**
- DesktopSahaayak-Setup.exe — recommended installer (49.8 MiB)
  sha256: $SETUP_SHA
- DesktopSahaayak-portable.exe — single-file portable build (155.8 MiB)
  sha256: $PORT_SHA

The installer is not code-signed; SmartScreen may show "More info → Run anyway". Reinstalling over an older version keeps your pairing.
EOF
)

echo "==> Creating release $TAG"
RELEASE_JSON=$(python3 -c "
import json, sys
body = sys.stdin.read()
print(json.dumps({
  'tag_name': 'connector-v1.4.0',
  'target_commitish': 'main',
  'name': 'Desktop Sahaayak v1.4.0',
  'body': body,
  'draft': False,
  'prerelease': False,
}))
" <<EOF2
$BODY
EOF2
)

RESP=$(curl -s -X POST \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/contactgrahicsworld-ui/CopySahaayak/releases" \
  -d "$RELEASE_JSON")
RELEASE_ID=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or ''); msg=d.get('message'); print(msg or '', file=sys.stderr)")
if [ -z "$RELEASE_ID" ]; then echo "RELEASE CREATE FAILED"; exit 1; fi
echo "==> release id: $RELEASE_ID"

upload_asset() {
  local file=$1 name=$2
  echo "==> uploading $name ($(stat -c %s "$file") bytes)"
  local tries=0
  while :; do
    tries=$((tries+1))
    UP=$(curl -s -X POST \
      -H "Authorization: Bearer $GH_TOKEN" \
      -H "Content-Type: application/octet-stream" \
      --data-binary @"$file" \
      "https://uploads.github.com/repos/contactgrahicsworld-ui/CopySahaayak/releases/$RELEASE_ID/assets?name=$name")
    OK=$(echo "$UP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('yes' if d.get('browser_download_url') else 'no')" 2>/dev/null || echo no)
    [ "$OK" = "yes" ] && { echo "    uploaded OK"; break; }
    if [ $tries -ge 3 ]; then echo "    UPLOAD FAILED: $(echo "$UP" | head -c 200)"; return 1; fi
    echo "    retry $tries..."
    sleep 5
  done
}

upload_asset "$SETUP" "DesktopSahaayak-Setup.exe"
upload_asset "$PORTABLE" "DesktopSahaayak-portable.exe"

echo "==> Verifying release assets"
curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "https://api.github.com/repos/contactgrahicsworld-ui/CopySahaayak/releases/tags/$TAG" \
  | python3 -c "
import json,sys
d = json.load(sys.stdin)
for a in d.get('assets', []):
    print(f\"  {a['name']}  {a['size']} bytes  state={a['state']}\")"
echo "==> DONE"
