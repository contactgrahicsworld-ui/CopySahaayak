#!/usr/bin/env bash
# API-based cleanup of E2E test data — works without direct DB access.
# Deletes only shops whose slug matches ^e2e- (test shops created by e2e-api.mjs).
# Real shops are never touched. Uses the super admin session via the production API.
set -euo pipefail
BASE="${BASE_URL:-https://copysahaayak.vercel.app}"
JAR="${JAR:-/tmp/jar-super.txt}"

login() {
  curl -sS --max-time 30 -c "$JAR" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${E2E_SUPER_EMAIL:-super@copysahaayak.app}\",\"password\":\"${E2E_SUPER_PASSWORD:-Cs-Platform-2026!Vn7qZ}\"}" > /dev/null
}

# Reuse a valid session; only spend a login attempt when the jar is stale.
if ! curl -fsS --max-time 30 -b "$JAR" "$BASE/api/super/shops" -o /dev/null 2>/dev/null; then
  login
fi
shops_json=$(curl -sS --max-time 30 -b "$JAR" "$BASE/api/super/shops")

echo "$shops_json" | python3 -c '
import json, sys, subprocess, os
data = json.load(sys.stdin)
shops = data.get("shops") or data
base = os.environ.get("BASE_URL", "https://copysahaayak.vercel.app")
jar = os.environ.get("JAR", "/tmp/jar-super.txt")
deleted, kept = 0, 0
for s in shops:
    slug = s.get("slug") or ""
    sid = s.get("id")
    if slug.startswith("e2e-"):
        r = subprocess.run(
            ["curl", "-sS", "--max-time", "60", "-b", jar, "-X", "DELETE",
             "-H", "Content-Type: application/json",
             "-d", json.dumps({"confirm": slug}),
             f"{base}/api/super/shops/{sid}"],
            capture_output=True, text=True)
        out = (r.stdout or "").strip()[:80]
        ok = ("ok" in out.lower()) and ("error" not in out.lower())
        print(f"DELETE e2e shop {slug} ({sid}): {out}")
        deleted += 1 if ok else 0
    else:
        print(f"KEEP real shop {slug}")
        kept += 1
print(f"--- deleted {deleted} e2e shops, kept {kept} real shops ---")
'
