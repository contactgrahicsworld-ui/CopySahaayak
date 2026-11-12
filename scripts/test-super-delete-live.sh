#!/usr/bin/env bash
# Live test of DELETE /api/super/users — uses disposable temp supers ONLY.
# The real owner's account is never touched.
set -uo pipefail
BASE="https://copysahaayak.vercel.app"
FAIL=0

step() { echo ""; echo "=== $1 ==="; }
check() { if [[ "$2" == "$3" ]]; then echo "PASS: $1"; else echo "FAIL: $1 (got '$2', want '$3')"; FAIL=1; fi }

step "0. current supers in DB"
cd "$(dirname "$0")/.."
node --input-type=module -e "
import { readFileSync } from 'fs'; import pg from 'pg';
const t = readFileSync('/tmp/vercel-env-cli.txt','utf8');
const get = k => (t.match(new RegExp('^'+k+'=\"?(.*?)\"?\$','m'))||[])[1]||'';
const c = new pg.Client({ connectionString: get('DIRECT_URL')||get('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(\"SELECT email, id FROM csp.\\\"User\\\" WHERE role='SUPER_ADMIN' ORDER BY \\\"createdAt\\\"\");
for (const row of r.rows) console.log(' -', row.email, row.id.slice(0,8));
await c.end();
"

step "1. login as temp A (disposable)"
LOGIN=$(curl -s -c /tmp/tmpa.jar -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d '{"email":"tempdel-a@check.local","password":"TempDel#1x"}')
ROLE=$(echo "$LOGIN" | python3 -c "import json,sys;print(json.load(sys.stdin).get('user',{}).get('role',''))")
check "temp A login role=SUPER_ADMIN" "$ROLE" "SUPER_ADMIN"

B_ID=$(node --input-type=module -e "
import { readFileSync } from 'fs'; import pg from 'pg';
const t = readFileSync('/tmp/vercel-env-cli.txt','utf8');
const get = k => (t.match(new RegExp('^'+k+'=\"?(.*?)\"?\$','m'))||[])[1]||'';
const c = new pg.Client({ connectionString: get('DIRECT_URL')||get('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(\"SELECT id FROM csp.\\\"User\\\" WHERE email='tempdel-b@check.local'\");
console.log(r.rows[0].id);
await c.end();
")
echo "temp B id: ${B_ID:0:8}…"

step "2. unauthenticated DELETE must be refused"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/super/users" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"userId\":\"$B_ID\",\"password\":\"whatever\"}")
if [[ "$CODE" == "401" || "$CODE" == "403" ]]; then echo "PASS: unauth DELETE rejected ($CODE)"; else echo "FAIL: unauth DELETE rejected (got $CODE)"; FAIL=1; fi

step "3. WRONG caller password must be refused"
CODE=$(curl -s -b /tmp/tmpa.jar -o /tmp/del-wrong.json -w '%{http_code}' -X DELETE "$BASE/api/super/users" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"userId\":\"$B_ID\",\"password\":\"WrongPass#99\"}")
check "wrong-password DELETE = 401" "$CODE" "401"
B_STILL=$(node --input-type=module -e "
import { readFileSync } from 'fs'; import pg from 'pg';
const t = readFileSync('/tmp/vercel-env-cli.txt','utf8');
const get = k => (t.match(new RegExp('^'+k+'=\"?(.*?)\"?\$','m'))||[])[1]||'';
const c = new pg.Client({ connectionString: get('DIRECT_URL')||get('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(\"SELECT count(*)::int n FROM csp.\\\"User\\\" WHERE email='tempdel-b@check.local'\");
console.log(r.rows[0].n); await c.end();")
check "temp B still exists after denial" "$B_STILL" "1"

step "4. correct password deletes OTHER super (caller stays)"
CODE=$(curl -s -b /tmp/tmpa.jar -o /tmp/del-ok.json -w '%{http_code}' -X DELETE "$BASE/api/super/users" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"userId\":\"$B_ID\",\"password\":\"TempDel#1x\"}")
BODY=$(cat /tmp/del-ok.json)
check "DELETE temp B = 200" "$CODE" "200"
SELF=$(echo "$BODY" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('selfDeleted'))")
check "selfDeleted=false" "$SELF" "False"
B_GONE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d '{"email":"tempdel-b@check.local","password":"TempDel#2x"}')
check "temp B login now 401" "$B_GONE" "401"

step "5. self-delete as caller (a remaining real owner exists)"
CODE=$(curl -s -b /tmp/tmpa.jar -o /tmp/del-self.json -w '%{http_code}' -X DELETE "$BASE/api/super/users" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d "{\"userId\":\"$(node --input-type=module -e "
import { readFileSync } from 'fs'; import pg from 'pg';
const t = readFileSync('/tmp/vercel-env-cli.txt','utf8');
const get = k => (t.match(new RegExp('^'+k+'=\"?(.*?)\"?\$','m'))||[])[1]||'';
const c = new pg.Client({ connectionString: get('DIRECT_URL')||get('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(\"SELECT id FROM csp.\\\"User\\\" WHERE email='tempdel-a@check.local'\");
console.log(r.rows[0].id); await c.end();")\",\"password\":\"TempDel#1x\"}")
BODY=$(cat /tmp/del-self.json)
check "self-DELETE temp A = 200" "$CODE" "200"
SELF2=$(echo "$BODY" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('selfDeleted'))")
check "selfDeleted=true" "$SELF2" "True"
A_GONE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" -H "Content-Type: application/json" -H "Origin: $BASE" \
  -d '{"email":"tempdel-a@check.local","password":"TempDel#1x"}')
check "temp A login now 401" "$A_GONE" "401"

step "6. final state — only the real owner remains"
node --input-type=module -e "
import { readFileSync } from 'fs'; import pg from 'pg';
const t = readFileSync('/tmp/vercel-env-cli.txt','utf8');
const get = k => (t.match(new RegExp('^'+k+'=\"?(.*?)\"?\$','m'))||[])[1]||'';
const c = new pg.Client({ connectionString: get('DIRECT_URL')||get('DATABASE_URL'), ssl: { rejectUnauthorized: false } });
await c.connect();
const s = await c.query(\"SELECT email FROM csp.\\\"User\\\" WHERE role='SUPER_ADMIN'\");
console.log('supers:', s.rows.map(r=>r.email).join(', '));
const orph = await c.query(\"SELECT count(*)::int n FROM csp.\\\"Session\\\" se LEFT JOIN csp.\\\"User\\\" u ON u.id=se.\\\"userId\\\" WHERE u.id IS NULL\");
console.log('orphan sessions:', orph.rows[0].n);
await c.end();
"

echo ""
[[ "$FAIL" == "0" ]] && echo "ALL DELETE-FLOW CHECKS PASSED" || echo "SOME CHECKS FAILED"
exit $FAIL
