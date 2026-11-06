#!/usr/bin/env bash
#
# Publishes a Desktop Sahaayak release end-to-end (one command, no manual steps):
#   1. verifies the built artifacts + version lockstep (csproj == argument)
#   2. creates/reuses the GitHub release connector-v<VERSION>, uploads both assets
#      (same-named assets are replaced so a rerun is always safe)
#   3. updates src/lib/connector-version.ts, commits and pushes to main
#   4. triggers the Vercel production deployment for the pushed SHA and polls READY
#   5. live-verifies: version endpoint, byte-exact download, homepage badge
#
# Usage: scripts/publish-release.sh <version>   e.g. scripts/publish-release.sh 1.5.0
set -euo pipefail

VERSION="${1:?Usage: publish-release.sh <version>}"
TAG="connector-v${VERSION}"
ROOT="/home/z/my-project"
SETUP="$ROOT/download/connector/DesktopSahaayak-Setup.exe"
PORTABLE="$ROOT/download/connector/DesktopSahaayak-portable.exe"
REPO="contactgrahicsworld-ui/CopySahaayak"
REPO_ID="1442824032"
VERCEL_TEAM="team_kjzlL9oti3ciMWtCz2ye5IHy"
GITHUB_API="https://api.github.com"
UPLOAD_API="https://uploads.github.com"

step() { echo "==> $*"; }

# --- credentials: taken from the git remote, never printed -------------------
REMOTE_URL=$(git -C "$ROOT" remote get-url origin)
GH_TOKEN=$(printf '%s' "$REMOTE_URL" | sed -n 's#https://[^:/]*:\([^@]*\)@github.com/.*#\1#p')
if [[ -z "$GH_TOKEN" ]]; then echo "ERROR: no embedded token in git remote" >&2; exit 1; fi
gh() { curl -sS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$@"; }

# --- 1. artifacts ------------------------------------------------------------
step "Checking artifacts for $VERSION"
for f in "$SETUP" "$PORTABLE"; do
  [[ -f "$f" ]] || { echo "ERROR: missing $f (run scripts/build-connector.sh first)" >&2; exit 1; }
done
CSproj_VER=$(sed -n 's/.*<Version>\(.*\)<\/Version>.*/\1/p' "$ROOT/connector/PrintSahayakConnector/PrintSahayakConnector.csproj" | head -1)
if [[ "$CSproj_VER" != "$VERSION" ]]; then
  echo "ERROR: csproj version is $CSproj_VER, not $VERSION — bump the csproj first" >&2
  exit 1
fi
sha256sum "$SETUP" "$PORTABLE"
SETUP_SHA=$(sha256sum "$SETUP" | awk '{print $1}')
SETUP_SIZE=$(stat -c '%s' "$SETUP")

# --- 2. GitHub release -------------------------------------------------------
step "Looking up release $TAG"
REL_ID=$(gh "$GITHUB_API/repos/$REPO/releases/tags/$TAG" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get('id') or '')
except Exception:
    print('')
")
if [[ -z "$REL_ID" ]]; then
  step "Creating release $TAG"
  REL_ID=$(gh -X POST "$GITHUB_API/repos/$REPO/releases" \
    -d "{\"tag_name\":\"$TAG\",\"target_commitish\":\"main\",\"name\":\"Desktop Sahaayak v$VERSION\",\"body\":\"Windows connector v$VERSION\\n\\n- Update check: the app now detects new versions itself (Hindi balloon, click to download)\\n- Printer Settings: Hindi guidance + one-click Windows printer settings when no printer is installed\\n- Status window: Hindi printer status\\n\\nInstaller SHA-256: $SETUP_SHA\"}" \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
  [[ -n "$REL_ID" ]] || { echo "ERROR: release creation failed" >&2; exit 1; }
fi
echo "    release id: $REL_ID"

upload_asset() {
  local name="$1" file="$2"
  # replace an existing asset with the same name (idempotent rerun)
  local existing
  existing=$(gh "$GITHUB_API/repos/$REPO/releases/$REL_ID/assets" | python3 -c "
import json,sys
name='$name'
try:
    for a in json.load(sys.stdin):
        if a.get('name')==name:
            print(a['id']); break
except Exception:
    pass
")
  if [[ -n "${existing:-}" ]]; then
    echo "    deleting stale asset $name (id $existing)"
    gh -X DELETE "$GITHUB_API/repos/$REPO/releases/assets/$existing" > /dev/null || true
  fi
  echo "    uploading $name ($(stat -c '%s' "$file") bytes)"
  local http
  http=$(curl -sS -o /tmp/asset-upload.json -w '%{http_code}' \
    -H "Authorization: Bearer $GH_TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary "@$file" \
    "$UPLOAD_API/repos/$REPO/releases/$REL_ID/assets?name=$name")
  [[ "$http" == "201" ]] || { echo "ERROR: upload failed ($http):" >&2; cat /tmp/asset-upload.json >&2; exit 1; }
}

upload_asset "DesktopSahaayak-Setup.exe" "$SETUP"
upload_asset "DesktopSahaayak-portable.exe" "$PORTABLE"

# --- 3. version constant + commit + push -------------------------------------
step "Pinning connector version in src/lib/connector-version.ts"
sed -i "s/export const CONNECTOR_VERSION = '.*'/export const CONNECTOR_VERSION = '$VERSION'/" "$ROOT/src/lib/connector-version.ts"
grep -n "CONNECTOR_VERSION = " "$ROOT/src/lib/connector-version.ts"

cd "$ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "Release Desktop Sahaayak v$VERSION (self-update check + Hindi printer guidance)" \
             -m "Installer sha256: $SETUP_SHA"
fi
git push origin main
SHA=$(git rev-parse HEAD)
echo "    pushed $SHA"

# --- 4. Vercel production deploy ---------------------------------------------
step "Triggering Vercel production deployment"
DEP_ID=$(curl -sS -X POST \
  "https://api.vercel.com/v13/deployments?teamId=$VERCEL_TEAM&skipAutoDetectionConfirmation=1" \
  -H "Authorization: Bearer ${VERCEL_TOKEN:-}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"copysahaayak\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"repoId\":$REPO_ID,\"ref\":\"$SHA\"}}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d)")
echo "    deployment: $DEP_ID"
[[ "$DEP_ID" == dpl_* ]] || { echo "ERROR: deployment not accepted: $DEP_ID" >&2; exit 1; }

step "Polling deployment state"
for i in $(seq 1 60); do
  sleep 10
  STATE=$(curl -sS "https://api.vercel.com/v13/deployments/$DEP_ID?teamId=$VERCEL_TEAM" \
    -H "Authorization: Bearer ${VERCEL_TOKEN:-}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('readyState',''))")
  echo "    [$((i*10))s] $STATE"
  if [[ "$STATE" == "READY" ]]; then break; fi
  if [[ "$STATE" == "ERROR" || "$STATE" == "CANCELED" ]]; then echo "ERROR: deployment $STATE" >&2; exit 1; fi
done
[[ "$STATE" == "READY" ]] || { echo "ERROR: deployment did not become ready" >&2; exit 1; }

# --- 5. live verification ------------------------------------------------------
step "Live verification"
LIVE_VERSION=$(curl -sS "https://copysahaayak.vercel.app/api/downloads/connector/version" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version',''))")
if [[ "$LIVE_VERSION" != "$VERSION" ]]; then
  echo "ERROR: live version endpoint returned '$LIVE_VERSION', expected '$VERSION'" >&2
  exit 1
fi
echo "    version endpoint: $LIVE_VERSION ✓"

curl -sSL -o /tmp/live-setup-check.exe "https://copysahaayak.vercel.app/api/downloads/connector"
LIVE_SHA=$(sha256sum /tmp/live-setup-check.exe | awk '{print $1}')
if [[ "$LIVE_SHA" != "$SETUP_SHA" ]]; then
  echo "ERROR: live download sha mismatch: $LIVE_SHA != $SETUP_SHA" >&2
  exit 1
fi
echo "    live download sha256 matches ✓ ($(stat -c '%s' /tmp/live-setup-check.exe) bytes)"

step "RELEASE $VERSION PUBLISHED AND VERIFIED LIVE"
