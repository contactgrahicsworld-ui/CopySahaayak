#!/usr/bin/env bash
# Super admin credential swap using the app's BUILT-IN audited handover flow:
#   1) login old super  2) self-handover (password-confirmed, sessions revoked)
#   3) old login dead   4) /setup reopens  5) fresh super created (NO UPI — owner sets it)
set -euo pipefail
BASE="https://copysahaayak.vercel.app"
OLD_EMAIL="super@copysahaayak.app"
OLD_PASS="Cs-Platform-2026!Vn7qZ"
NEW_NAME="Super Admin"
NEW_EMAIL="superadmin@copysahaayak.app"
NEW_PASS="Cs-Super-2026!Kq8mZw"
JAR=/tmp/jar-old-super.txt
JAR2=/tmp/jar-super.txt
rm -f "$JAR" "$JAR2"

echo "== 1) login OLD super =="
code=$(curl -s -o /tmp/login-old.json -w '%{http_code}' -c "$JAR" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$OLD_EMAIL\",\"password\":\"$OLD_PASS\"}")
echo "old login: $code $(cat /tmp/login-old.json | head -c 120)"
[ "$code" = "200" ] || { echo "ABORT: old login failed"; exit 1; }

echo "== 2) sanity: old session lists users =="
code=$(curl -s -o /tmp/users-old.json -w '%{http_code}' -b "$JAR" "$BASE/api/super/users")
echo "super/users GET: $code (users listed: $(python3 -c "import json;d=json.load(open('/tmp/users-old.json'));print(len(d.get('data',{}).get('users',[])))" 2>/dev/null || echo '?'))"

echo "== 3) HANDOVER (self-deactivate, password-confirmed) =="
code=$(curl -s -o /tmp/handover.json -w '%{http_code}' -b "$JAR" -X PATCH "$BASE/api/super/users" \
  -H 'Content-Type: application/json' -d "{\"password\":\"$OLD_PASS\"}")
echo "handover: $code $(cat /tmp/handover.json | head -c 120)"

echo "== 4) OLD login must now FAIL =="
code=$(curl -s -o /tmp/login-old2.json -w '%{http_code}' -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$OLD_EMAIL\",\"password\":\"$OLD_PASS\"}")
echo "old login after handover: $code (expect 401)"
[ "$code" = "401" ] || echo "WARNING: old login returned $code"

echo "== 5) /setup must be REOPENED =="
curl -s "$BASE/api/setup" | head -c 200; echo

echo "== 6) create FRESH super admin (no UPI — owner will set it) =="
code=$(curl -s -o /tmp/setup-post.json -w '%{http_code}' -X POST "$BASE/api/setup" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$NEW_NAME\",\"email\":\"$NEW_EMAIL\",\"password\":\"$NEW_PASS\"}")
echo "setup POST: $code $(cat /tmp/setup-post.json | head -c 200)"
[ "$code" = "200" ] || { echo "ABORT: setup failed"; exit 1; }

echo "== 7) /setup must now be CLOSED =="
curl -s "$BASE/api/setup" | head -c 200; echo

echo "== 8) login NEW super =="
code=$(curl -s -o /tmp/login-new.json -w '%{http_code}' -c "$JAR2" -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"email\":\"$NEW_EMAIL\",\"password\":\"$NEW_PASS\"}")
echo "new login: $code $(cat /tmp/login-new.json | head -c 120)"
[ "$code" = "200" ] || { echo "ABORT: new login failed"; exit 1; }

echo "== 9) new super session works on super API =="
code=$(curl -s -o /tmp/users-new.json -w '%{http_code}' -b "$JAR2" "$BASE/api/super/users")
echo "super/users GET with NEW session: $code"
python3 -c "
import json
d=json.load(open('/tmp/users-new.json'))
users=d.get('data',{}).get('users',[])
for u in users:
    if u['role']=='SUPER_ADMIN':
        print('SUPER_ADMIN account:', u['email'], '| active:', u['isActive'])
" 2>/dev/null || true
echo "SWAP COMPLETE"
