#!/usr/bin/env bash
#
# Publishes a Desktop Sahaayak release end-to-end (one command, no manual steps).
#
# IMPORTANT PIPELINE CONTRACT:
#   The canonical release build is GitHub Actions (build-connector.yml) on
#   windows-latest — it runs on a real Windows runner and applies code signing
#   when a signing certificate is configured. This script must NEVER upload
#   release assets itself: a manual upload races the workflow's `gh release
#   upload --clobber` and the "verified" hash silently becomes wrong.
#
# Flow:
#   1. verifies the local build exists and matches the csproj version (compile proof)
#   2. commits any pending changes and pushes main
#   3. pushes the tag connector-v<VERSION> — CI then builds on Windows and
#      publishes the release with both assets (atomic: /releases/latest keeps
#      pointing at the previous release until the new assets exist, so the
#      download link never 404s)
#   4. polls the release until both assets are uploaded, downloads and verifies
#      them (PE magic, embedded version, hash stability across two downloads)
#   5. triggers the Vercel production deployment and polls READY
#   6. live-verifies: version endpoint, byte-exact download, homepage badge
#
# Usage: scripts/publish-release.sh <version>   e.g. scripts/publish-release.sh 1.5.1
# Requires: VERCEL_TOKEN in the environment.
set -euo pipefail

VERSION="${1:?Usage: publish-release.sh <version>}"
TAG="connector-v${VERSION}"
ROOT="/home/z/my-project"
REPO="contactgrahicsworld-ui/CopySahaayak"
REPO_ID="1442824032"
VERCEL_TEAM="team_kjzlL9oti3ciMWtCz2ye5IHy"
SITE="https://copysahaayak.vercel.app"
GITHUB_API="https://api.github.com"

step() { echo "==> $*"; }

# --- credentials: taken from the git remote, never printed -------------------
REMOTE_URL=$(git -C "$ROOT" remote get-url origin)
GH_TOKEN=$(printf '%s' "$REMOTE_URL" | sed -n 's#https://[^:/]*:\([^@]*\)@github.com/.*#\1#p')
if [[ -z "$GH_TOKEN" ]]; then echo "ERROR: no embedded token in git remote" >&2; exit 1; fi
: "${VERCEL_TOKEN:?set VERCEL_TOKEN in the environment}"

# --- 1. local build sanity ----------------------------------------------------
step "Checking local build for $VERSION (compile proof only — CI builds the release)"
CSproj_VER=$(sed -n 's/.*<Version>\(.*\)<\/Version>.*/\1/p' "$ROOT/connector/PrintSahayakConnector/PrintSahayakConnector.csproj" | head -1)
if [[ "$CSproj_VER" != "$VERSION" ]]; then
  echo "ERROR: csproj version is $CSproj_VER, not $VERSION — bump the csproj first" >&2
  exit 1
fi
for f in "$ROOT/connector/publish/PrintSahayakConnector.exe" "$ROOT/connector/installer/DesktopSahaayak-Setup.exe"; do
  [[ -f "$f" ]] || { echo "ERROR: missing $f (run scripts/build-connector.sh first)" >&2; exit 1; }
done
echo "    csproj=$CSproj_VER, local artifacts present ✓"

# --- 2. version constant + commit + push --------------------------------------
step "Pinning connector version in src/lib/connector-version.ts"
sed -i "s/export const CONNECTOR_VERSION = '.*'/export const CONNECTOR_VERSION = '$VERSION'/" "$ROOT/src/lib/connector-version.ts"
grep -n "CONNECTOR_VERSION = " "$ROOT/src/lib/connector-version.ts"

cd "$ROOT"
if [[ -n "$(git status --porcelain)" ]]; then
  git add -A
  git commit -m "Release Desktop Sahaayak v$VERSION"
fi
git push origin main
SHA=$(git rev-parse HEAD)
echo "    pushed $SHA"

# --- 3. tag → CI build + release -----------------------------------------------
step "Pushing tag $TAG (CI builds on Windows and publishes the release)"
if git rev-parse -q --verify "refs/tags/$TAG" > /dev/null; then
  echo "ERROR: tag $TAG already exists — delete it first (git push origin :refs/tags/$TAG)" >&2
  exit 1
fi
git tag "$TAG" "$SHA"
git push origin "refs/tags/$TAG"

# --- 4. poll release assets, download, verify -----------------------------------
step "Waiting for CI to upload release assets (up to 30 min)"
ASSET_LIST=""
for i in $(seq 1 90); do
  sleep 20
  ASSET_LIST=$(curl -sS -H "Authorization: Bearer $GH_TOKEN" \
    "$GITHUB_API/repos/$REPO/releases/tags/$TAG" \
    | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    names=[a['name'] for a in d.get('assets',[]) if a.get('state')=='uploaded']
    print(','.join(names))
except Exception:
    print('')
")
  if echo "$ASSET_LIST" | grep -q "DesktopSahaayak-Setup.exe" && echo "$ASSET_LIST" | grep -q "DesktopSahaayak-portable.exe"; then
    echo "    [$((i*20))s] both assets uploaded ✓"
    break
  fi
  echo "    [$((i*20))s] assets so far: ${ASSET_LIST:-none}"
done
if ! echo "$ASSET_LIST" | grep -q "DesktopSahaayak-Setup.exe"; then
  echo "ERROR: CI did not finish uploading within the timeout — check GitHub Actions" >&2
  exit 1
fi

verify_asset() {
  local name="$1" url="$2"
  local out1="/tmp/rel-check-1-$name" out2="/tmp/rel-check-2-$name"
  curl -sSL -o "$out1" "$url"
  curl -sSL -o "$out2" "$url"
  local h1 h2
  h1=$(sha256sum "$out1" | awk '{print $1}')
  h2=$(sha256sum "$out2" | awk '{print $1}')
  if [[ "$h1" != "$h2" ]]; then echo "ERROR: $name download unstable ($h1 vs $h2)" >&2; exit 1; fi
  # PE magic + embedded version (UTF-16LE, as in the VS_VERSION_INFO resource)
  if ! head -c 2 "$out1" | grep -q "MZ"; then echo "ERROR: $name is not a PE file" >&2; exit 1; fi
  local cnt
  cnt=$(python3 -c "
data=open('$out1','rb').read()
print(data.count('$VERSION.0'.encode('utf-16-le')))")
  if [[ "$cnt" -lt 1 ]]; then echo "ERROR: $name does not contain version $VERSION" >&2; exit 1; fi
  echo "    $name sha256=$h1 (stable across 2 downloads, PE, contains $VERSION) ✓"
}

BASE_DL="https://github.com/$REPO/releases/download/$TAG"
verify_asset "DesktopSahaayak-Setup.exe" "$BASE_DL/DesktopSahaayak-Setup.exe"
verify_asset "DesktopSahaayak-portable.exe" "$BASE_DL/DesktopSahaayak-portable.exe"
SETUP_SHA=$(sha256sum "/tmp/rel-check-1-DesktopSahaayak-Setup.exe" | awk '{print $1}')

# --- 5. Vercel production deploy ------------------------------------------------
step "Triggering Vercel production deployment"
DEP_ID=$(curl -sS -X POST \
  "https://api.vercel.com/v13/deployments?teamId=$VERCEL_TEAM&skipAutoDetectionConfirmation=1" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"copysahaayak\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"repoId\":$REPO_ID,\"ref\":\"$SHA\"}}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id') or d)")
echo "    deployment: $DEP_ID"
[[ "$DEP_ID" == dpl_* ]] || { echo "ERROR: deployment not accepted: $DEP_ID" >&2; exit 1; }

STATE=""
for i in $(seq 1 60); do
  sleep 10
  STATE=$(curl -sS "https://api.vercel.com/v13/deployments/$DEP_ID?teamId=$VERCEL_TEAM" \
    -H "Authorization: Bearer $VERCEL_TOKEN" | python3 -c "import json,sys; print(json.load(sys.stdin).get('readyState',''))")
  echo "    [$((i*10))s] $STATE"
  if [[ "$STATE" == "READY" ]]; then break; fi
  if [[ "$STATE" == "ERROR" || "$STATE" == "CANCELED" ]]; then echo "ERROR: deployment $STATE" >&2; exit 1; fi
done
[[ "$STATE" == "READY" ]] || { echo "ERROR: deployment did not become ready" >&2; exit 1; }

# --- 6. live verification ---------------------------------------------------------
step "Live verification"
LIVE_VERSION=$(curl -sS "$SITE/api/downloads/connector/version" | python3 -c "import json,sys; print(json.load(sys.stdin).get('version',''))")
if [[ "$LIVE_VERSION" != "$VERSION" ]]; then
  echo "ERROR: live version endpoint returned '$LIVE_VERSION', expected '$VERSION'" >&2
  exit 1
fi
echo "    version endpoint: $LIVE_VERSION ✓"

curl -sSL -o /tmp/live-setup-pub.exe "$SITE/api/downloads/connector"
LIVE_SHA=$(sha256sum /tmp/live-setup-pub.exe | awk '{print $1}')
if [[ "$LIVE_SHA" != "$SETUP_SHA" ]]; then
  echo "ERROR: live download sha mismatch: $LIVE_SHA != $SETUP_SHA" >&2
  exit 1
fi
echo "    live download sha256 matches the CI release asset ✓"

if curl -sS "$SITE/" | grep -q "v$VERSION"; then
  echo "    homepage badge shows v$VERSION ✓"
else
  echo "    NOTE: homepage badge not updated yet (ISR cache) — check later"
fi

step "RELEASE $VERSION PUBLISHED AND VERIFIED LIVE"
