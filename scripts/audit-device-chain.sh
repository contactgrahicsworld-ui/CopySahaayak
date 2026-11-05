#!/bin/bash
# Live E2E: full device/connector chain simulation against production
# Tests: pairing -> heartbeat (printer registration) -> job claim -> print events
set -e
BASE_URL="https://copysahaayak.vercel.app"
JAR_SHOP=/tmp/jar-shop.txt

echo "=== 1. Shop owner creates pairing code"
PAIR=$(curl -s -b $JAR_SHOP -X POST "$BASE_URL/api/admin/devices" -H "Content-Type: application/json" -d '{"name":"AuditTest-PC"}')
echo "$PAIR" | head -c 400; echo
CODE=$(echo "$PAIR" | python3 -c "import json,sys; print(json.load(sys.stdin)['device']['pairingCode'])")
DEEP=$(echo "$PAIR" | python3 -c "import json,sys; print(json.load(sys.stdin).get('deepLink',''))")
echo "pairingCode=$CODE"

echo "=== 2. Device pairs (connector simulation)"
PAIRED=$(curl -s -X POST "$BASE_URL/api/device/pair" -H "Content-Type: application/json" -d "{\"pairingCode\":\"$CODE\",\"machineName\":\"AUDIT-PC\",\"appVersion\":\"1.3.2\"}")
echo "$PAIRED" | head -c 300; echo
DTOK=$(echo "$PAIRED" | python3 -c "import json,sys; print(json.load(sys.stdin)['deviceToken'])")
echo "deviceToken: ${DTOK:0:8}..."

echo "=== 3. Device heartbeat with printers (printer registration)"
HB=$(curl -s -X POST "$BASE_URL/api/device/heartbeat" -H "Authorization: Bearer $DTOK" -H "Content-Type: application/json" -d '{
  "printers": [
    {"windowsName":"HP LaserJet M1136 MFP","colorMode":"BW","paperSizes":["A4"]},
    {"windowsName":"Canon PIXMA G3010","colorMode":"COLOR","paperSizes":["A4","A5"]}
  ],
  "appVersion":"1.3.2"
}')
echo "heartbeat: $HB"

echo "=== 4. Shop owner sees printers registered"
curl -s -b $JAR_SHOP "$BASE_URL/api/admin/printers" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in d.get('printers',[]):
    print('-', p.get('windowsName'), '|', p.get('colorMode'), '|', p.get('status'))
"

echo "=== 5. Customer creates new order"
SESS=$(curl -s -c /tmp/jar-cust2.txt -X POST "$BASE_URL/api/shops/mansa/session" -H "Content-Type: application/json" -d '{}')
CSID=$(echo "$SESS" | python3 -c "import json,sys; print(json.load(sys.stdin)['sessionId'])")
UP=$(curl -s -b /tmp/jar-cust2.txt -X POST "$BASE_URL/api/shops/mansa/uploads" -F "file=@/tmp/test.pdf;type=application/pdf")
DOCID=$(echo "$UP" | python3 -c "import json,sys; print(json.load(sys.stdin)['documentId'])")
ORD=$(curl -s -b /tmp/jar-cust2.txt -X POST "$BASE_URL/api/shops/mansa/orders" -H "Content-Type: application/json" -d "{\"sessionId\":\"$CSID\",\"items\":[{\"documentId\":\"$DOCID\",\"colorMode\":\"BW\",\"paperSize\":\"A4\",\"duplex\":false,\"copies\":2}],\"customerName\":\"DeviceChainTest\",\"customerPhone\":\"9999999998\"}")
ON=$(echo "$ORD" | python3 -c "import json,sys; print(json.load(sys.stdin)['orderNumber'])")
echo "order=$ON (BW A4 x2 — should route to HP LaserJet)"

echo "=== 6. Customer submits UTR, owner verifies -> job queued"
curl -s -b /tmp/jar-cust2.txt -X POST "$BASE_URL/api/shops/mansa/orders/$ON/utr" -H "Content-Type: application/json" -d '{"utr":"987654321098","payerName":"DeviceChainTest"}' | head -c 120; echo
PID=$(curl -s -b $JAR_SHOP "$BASE_URL/api/admin/payments" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for p in d.get('payments',[]):
    if p.get('orderNumber')=='$ON' or (p.get('order') or {}).get('orderNumber')=='$ON': print(p['id']); break
")
echo "paymentId=$PID"
V=$(curl -s -b $JAR_SHOP -X POST "$BASE_URL/api/admin/payments/$PID" -H "Content-Type: application/json" -d '{"action":"VERIFY"}')
echo "verify: $V"
echo "--- order status after verify:"
curl -s -b $JAR_SHOP "$BASE_URL/api/admin/orders" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for o in d.get('orders',[]):
    if o.get('orderNumber')=='$ON': print('-', o.get('orderNumber'), '->', o.get('status'))
"

echo "=== 7. Device claims job"
CLAIM=$(curl -s -X POST "$BASE_URL/api/device/jobs/claim" -H "Authorization: Bearer $DTOK" -H "Content-Type: application/json" -d '{}')
echo "$CLAIM" | python3 -c "
import json,sys
d=json.load(sys.stdin)
j=d.get('job')
if not j: print('NO JOB CLAIMED — ROUTING FAILED')
else:
    print('jobId:', j['id'][:12], '| printer:', (j.get('printer') or {}).get('windowsName'), '| copies:', (j.get('printSettings') or {}).get('copies'), '| color:', (j.get('printSettings') or {}).get('colorMode'))
    print('downloadUrl:', (j.get('document') or {}).get('downloadUrl','')[:60])
" 
JOBID=$(echo "$CLAIM" | python3 -c "import json,sys; j=json.load(sys.stdin).get('job'); print(j['id'] if j else '')")

echo "=== 8. Print events: SPOOLING -> COMPLETED"
curl -s -X POST "$BASE_URL/api/device/jobs/$JOBID/events" -H "Authorization: Bearer $DTOK" -H "Content-Type: application/json" -d '{"status":"SPOOLING"}' | head -c 100; echo
curl -s -X POST "$BASE_URL/api/device/jobs/$JOBID/events" -H "Authorization: Bearer $DTOK" -H "Content-Type: application/json" -d '{"status":"COMPLETED","message":"Spooler confirmed"}' | head -c 100; echo

echo "=== 9. Order status (should be COMPLETED)"
curl -s -b $JAR_SHOP "$BASE_URL/api/admin/orders" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for o in d.get('orders',[]):
    if o.get('orderNumber')=='$ON': print('-', o.get('orderNumber'), '->', o.get('status'))
"
echo "=== DONE: device chain result above ==="
