#!/bin/bash
# Continuation: verify order PC-2611-0BR1L -> job routing -> claim -> print events
BASE_URL="https://copysahaayak.vercel.app"
JAR_SHOP=/tmp/jar-shop.txt
ON="PC-2611-0BR1L"

echo "=== 6a. Customer submits UTR for $ON"
curl -s -b /tmp/jar-cust2.txt -X POST "$BASE_URL/api/shops/mansa/orders/$ON/utr" -H "Content-Type: application/json" -d '{"utr":"987654321098","payerName":"DeviceChainTest"}' | head -c 150; echo

echo "=== 6b. Owner verifies payment"
PID=$(curl -s -b $JAR_SHOP "$BASE_URL/api/admin/payments" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in d.get('payments',[]):
    if p.get('orderNumber')=='$ON' or (p.get('order') or {}).get('orderNumber')=='$ON': print(p['id']); break
")
echo "paymentId=$PID"
curl -s -b $JAR_SHOP -X POST "$BASE_URL/api/admin/payments/$PID" -H "Content-Type: application/json" -d '{"action":"VERIFY"}' | head -c 120; echo

echo "=== 6c. Order status after verify (should be CONFIRMED)"
curl -s -b $JAR_SHOP "$BASE_URL/api/admin/orders" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for o in d.get('orders',[]):
    if o.get('orderNumber')=='$ON': print('-', o.get('orderNumber'), '->', o.get('status'))
"

echo "=== 7. Device claims job (expect printer=HP LaserJet, copies=2)"
CLAIM=$(curl -s -X POST "$BASE_URL/api/device/jobs/claim" -H "Authorization: Bearer $(cat /tmp/dtok.txt)" -H "Content-Type: application/json" -d '{}')
echo "$CLAIM" | python3 -c "
import json,sys
d=json.load(sys.stdin)
j=d.get('job')
if not j: print('NO JOB CLAIMED — ROUTING FAILED')
else:
    print('jobId:', j['id'][:14], '| printer:', (j.get('printer') or {}).get('windowsName'), '| copies:', (j.get('printSettings') or {}).get('copies'), '| color:', (j.get('printSettings') or {}).get('colorMode'), '| paper:', (j.get('printSettings') or {}).get('paperSize'))
"
JOBID=$(echo "$CLAIM" | python3 -c "import json,sys; j=json.load(sys.stdin).get('job'); print(j['id'] if j else '')")
echo "$JOBID" > /tmp/jobid.txt

echo "=== 8. Print events SPOOLING -> COMPLETED"
curl -s -X POST "$BASE_URL/api/device/jobs/$JOBID/events" -H "Authorization: Bearer $(cat /tmp/dtok.txt)" -H "Content-Type: application/json" -d '{"status":"SPOOLING"}' | head -c 100; echo
curl -s -X POST "$BASE_URL/api/device/jobs/$JOBID/events" -H "Authorization: Bearer $(cat /tmp/dtok.txt)" -H "Content-Type: application/json" -d '{"status":"COMPLETED","message":"Spooler confirmed"}' | head -c 100; echo

echo "=== 9. Order status (should be COMPLETED)"
curl -s -b $JAR_SHOP "$BASE_URL/api/admin/orders" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for o in d.get('orders',[]):
    if o.get('orderNumber')=='$ON': print('-', o.get('orderNumber'), '->', o.get('status'))
"
