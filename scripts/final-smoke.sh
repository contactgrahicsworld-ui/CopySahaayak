#!/bin/bash
# Final non-destructive live smoke: pages + shop-owner APIs + isolation probes
B="https://copysahaayak.vercel.app"
JAR=/tmp/jar-final-shop.txt
PASS=0; FAIL=0
ck() { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "PASS: $1 ($2)"; else FAIL=$((FAIL+1)); echo "FAIL: $1 got=$2 want=$3"; fi }

echo "== PUBLIC PAGES =="
for P in "/" "/login" "/register" "/setup" "/forgot-password" "/s/mansa" "/s/sharma" "/download"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$B$P")
  ck "page $P" "$CODE" "200"
done

echo "== SHOP OWNER LOGIN + APIs =="
rm -f "$JAR"
CODE=$(curl -s -o /tmp/login-final.json -w "%{http_code}" --max-time 30 -c "$JAR" -X POST "$B/api/auth/login" -H "Content-Type: application/json" -d '{"email":"contact.grahicsworld@gmail.com","password":"Cs-Shop-2026-Secure!x"}')
ck "owner login" "$CODE" "200"
for EP in "/api/admin/orders" "/api/admin/subscription" "/api/admin/devices" "/api/admin/reports" "/api/admin/pricing" "/api/admin/shop"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 -b "$JAR" "$B$EP")
  ck "owner API $EP" "$CODE" "200"
done

echo "== UNAUTH GUARDS (401/403 expected) =="
for EP in "/api/admin/orders" "/api/super/stats" "/api/super/shops" "/api/admin/shop"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$B$EP")
  if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then ck "guard $EP" "$CODE" "$CODE"; else ck "guard $EP" "$CODE" "401/403"; fi
done

echo "== ISOLATION: owner cannot reach super APIs =="
for EP in "/api/super/stats" "/api/super/shops" "/api/super/users" "/api/super/settings"; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 -b "$JAR" "$B$EP")
  if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then ck "isolation $EP" "$CODE" "403"; else ck "isolation $EP" "$CODE" "401/403"; fi
done

echo "== CONNECTOR DOWNLOAD =="
LOC=$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" --max-time 30 "$B/api/downloads/connector")
echo "connector endpoint: $LOC"

echo "== SETUP STATE =="
curl -s --max-time 30 "$B/api/setup"; echo

echo "RESULT: PASS=$PASS FAIL=$FAIL"
