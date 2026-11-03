#!/bin/bash
# Debug Supabase auth: config + recent auth logs (OTP/mail related)
TOKEN="${SUPABASE_MGMT_TOKEN:?export SUPABASE_MGMT_TOKEN first}"
REF="oqowxmrzaxnundghsrct"
API="https://api.supabase.com/v1"

echo "=== current UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

echo "=== AUTH CONFIG (mail + rate limits) ==="
curl -s -H "Authorization: Bearer $TOKEN" "$API/projects/$REF/config/auth" \
 | python3 -c "
import json,sys
d=json.load(sys.stdin)
keys=['EXTERNAL_EMAIL_ENABLED','MAILER_AUTOCONFIRM','MAILER_OTP_EXP','MAILER_OTP_LENGTH','MAILER_SUBJECTS_MAGIC_LINK','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_SENDER_NAME','SMTP_MAX_FREQUENCY','RATE_LIMIT_EMAIL_SENT','RATE_LIMIT_OTP','RATE_LIMIT_TOKEN_REFRESH','RATE_LIMIT_ANONYMOUS_USERS','SITE_URL','JWT_EXP','SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION','GOTRUE_MAILER_AUTOCONFIRM']
for k in keys:
    if k in d:
        v=d[k]
        if k=='SMTP_PASS' and v: v='<set:'+str(len(str(v)))+'chars>'
        print(f'{k} = {v}')
"

echo ""
echo "=== AUTH LOGS (last entries) ==="
SQL="select cast(timestamp as text) as ts, event_message from auth_logs order by timestamp desc limit 60"
ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$SQL")
curl -s -H "Authorization: Bearer $TOKEN" "$API/projects/$REF/logs?sql=$ENC" \
 | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception as e:
    print('parse error:', e); sys.exit()
if isinstance(d, dict):
    print(json.dumps(d)[:800]); sys.exit()
for r in d[:60]:
    msg=(r.get('event_message') or '')[:220]
    print(r.get('ts','')[:19].replace('T',' '), '|', msg)
"
