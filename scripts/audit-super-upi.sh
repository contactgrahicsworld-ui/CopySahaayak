#!/bin/bash
# Test super admin UPI settings -> subscription QR flow (then restore empty state)
BASE_URL="https://copysahaayak.vercel.app"
JAR_SUPER=/tmp/jar-super.txt
JAR_SHOP=/tmp/jar-shop.txt

echo "=== 1. Super sets platform UPI (test value)"
S1=$(curl -s -b $JAR_SUPER -X PUT "$BASE_URL/api/super/settings" -H "Content-Type: application/json" -d '{"super_admin_upi_vpa":"platform-test@upi","super_admin_payee_name":"CopySahaayak Platform"}')
echo "$S1" | head -c 200; echo

echo "=== 2. Verify setting persisted"
curl -s -b $JAR_SUPER "$BASE_URL/api/super/settings" | python3 -c "
import json,sys
d=json.load(sys.stdin)
s=d.get('settings',{})
print('vpa =', repr(s.get('super_admin_upi_vpa')), '| payee =', repr(s.get('super_admin_payee_name')))
"

echo "=== 3. Paid plans available?"
curl -s -b $JAR_SUPER "$BASE_URL/api/super/plans" | python3 -c "
import json,sys
d=json.load(sys.stdin)
plans=d.get('plans',[])
for p in plans:
    print('-', p.get('code'), '| price:', p.get('pricePaise'), '| active:', p.get('isActive'))
" 2>/dev/null || echo "plans endpoint shape differs"

echo "=== 4. Shop owner generates subscription QR (plan=PRO or first paid)"
PAID=$(curl -s -b $JAR_SUPER "$BASE_URL/api/super/plans" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in d.get('plans',[]):
    if p.get('pricePaise',0)>0 and p.get('isActive'): print(p['code']); break
")
echo "paid plan: $PAID"
QR=$(curl -s -b $JAR_SHOP "$BASE_URL/api/admin/subscription/qr?planCode=$PAID")
echo "$QR" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'error' in d: print('ERROR:', d['error'])
else:
    print('payload:', d.get('payload','')[:130])
    print('amount:', d.get('amountPaise'), '| vpa:', d.get('vpa'), '| payee:', d.get('payee'))
    print('dataUrl present:', bool(d.get('dataUrl')))
"

echo "=== 5. Owner submits subscription payment (UTR)"
SUB=$(curl -s -b $JAR_SHOP -X POST "$BASE_URL/api/admin/subscription" -H "Content-Type: application/json" -d "{\"planCode\":\"$PAID\",\"utr\":\"112233445566\"}")
echo "$SUB" | head -c 300; echo

echo "=== 6. Super sees subscription payment in queue"
curl -s -b $JAR_SUPER "$BASE_URL/api/super/subpayments" | python3 -c "
import json,sys
d=json.load(sys.stdin)
items=d.get('payments') or d.get('subpayments') or []
print('count:', len(items))
for p in items[:3]:
    print('-', p.get('id','?')[:14], '| status:', p.get('status'), '| utr:', p.get('utr'), '| shop:', (p.get('shop') or {}).get('name'))
"

echo "=== 7. Cleanup: restore empty UPI (user will set real UPI himself)"
curl -s -b $JAR_SUPER -X PUT "$BASE_URL/api/super/settings" -H "Content-Type: application/json" -d '{"super_admin_upi_vpa":"","super_admin_payee_name":""}' | head -c 120; echo
curl -s -b $JAR_SUPER "$BASE_URL/api/super/settings" | python3 -c "
import json,sys
s=json.load(sys.stdin).get('settings',{})
print('restored: vpa =', repr(s.get('super_admin_upi_vpa')))
"
