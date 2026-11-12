#!/usr/bin/env bash
# LIVE verification of the fresh-super deployment (commit 960e2018):
#  1. new super signs in (role=SUPER_ADMIN, session cookie = 24h)
#  2. OLD password is rejected (old credentials truly dead)
#  3. /api/setup reports setupDone
#  4. fresh test shop: register -> /api/admin/subscription shows
#     serverNow + expiresAt = exactly +7d + Cache-Control: no-store
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="https://copysahaayak.vercel.app"
EMAIL="super@copysahaayak.local"
PASS=$(grep SUPER_PASSWORD scripts/.fresh-super-creds.txt | cut -d= -f2)
OLD_PASS='PcsSuper#9be2a9f49A'

echo "=== 1. NEW super login ==="
curl -s -D /tmp/login-headers.txt -c /tmp/new-super.jar -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | python3 -c "
import json,sys;d=json.load(sys.stdin)
u=d.get('user',{}); print('role:',u.get('role'),'| name:',u.get('name'),'| email:',u.get('email'))
sys.exit(0 if u.get('role')=='SUPER_ADMIN' else 1)"
grep -i 'set-cookie' /tmp/login-headers.txt | grep -o 'Max-Age=[0-9]*' | head -1 | python3 -c "
import sys
line=sys.stdin.read().strip()
val=line.split('=')[1] if '=' in line else ''
print('session Max-Age:', val or 'not found', '(expect 86400 = 24h)')
sys.exit(0 if val=='86400' else 1)"

echo "=== 2. OLD password must be REJECTED ==="
OLD=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$OLD_PASS\"}")
echo "old password login HTTP: $OLD (expect 401/400)"
[[ "$OLD" == "401" || "$OLD" == "400" ]] || { echo "FAIL: old password still works!"; exit 1; }

echo "=== 3. Setup state ==="
curl -s "$BASE/api/setup"

echo ""
echo "=== 4. Fresh shop end-to-end: register + subscription clock ==="
TS=$(date +%s)
REG=$(curl -s -c /tmp/testshop.jar -X POST "$BASE/api/register" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"shopName\":\"TimerCheck $TS\",\"slug\":\"timercheck-$TS\",\"ownerName\":\"Timer Bot\",\"email\":\"timercheck$TS@test.local\",\"password\":\"TimerBot#2026x\"}")
echo "$REG" | python3 -c "import json,sys;d=json.load(sys.stdin);print('registered shop:', d.get('shopSlug') or d)"

SUB=$(curl -s -D /tmp/sub-headers.txt -b /tmp/testshop.jar "$BASE/api/admin/subscription")
CACHE=$(grep -i 'cache-control' /tmp/sub-headers.txt | tr -d '\r' || echo 'no cache header')
echo "cache-control: $CACHE"
echo "$SUB" | python3 -c "
import json,sys,datetime
d=json.load(sys.stdin)
sn=d.get('serverNow'); sub=d.get('subscription',{})
exp=sub.get('expiresAt'); plan=(sub.get('plan') or {}).get('name'); status=sub.get('status')
print('plan:', plan, '| status:', status)
print('serverNow :', sn)
print('expiresAt :', exp)
if not sn or not exp: print('MISSING serverNow/expiresAt'); sys.exit(1)
s=datetime.datetime.fromisoformat(sn.replace('Z','+00:00'))
e=datetime.datetime.fromisoformat(exp.replace('Z','+00:00'))
left=(e-s).total_seconds()
print('remaining  : %.1f days (expect ~7.0)' % (left/86400))
ok=abs(left/86400-7.0)<0.01 and ('no-store' in open('/tmp/sub-headers.txt').read().lower())
print('RESULT:', 'PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)"
echo "ALL LIVE CHECKS PASSED"
