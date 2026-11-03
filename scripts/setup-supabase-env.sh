#!/usr/bin/env bash
# Writes .env for CopySahaayak against the freshly provisioned Supabase project.
# Usage: SBP=<token> REF=<ref> DBPASSFILE=<file> bash scripts/setup-supabase-env.sh
set -euo pipefail
SBP="${SBP:?SBP token required}"
REF="${REF:?project ref required}"
DBPASS="$(cat "${DBPASSFILE:?dbpass file required}")"

read -r ANON SERVICE < <(curl -s -m 30 "https://api.supabase.com/v1/projects/${REF}/api-keys" \
  -H "Authorization: Bearer $SBP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
k={x['name']: x.get('api_key') for x in d}
print(k.get('anon') or '', k.get('service_role') or '')")
[ -n "$ANON" ] && [ -n "$SERVICE" ] || { echo 'key fetch failed' >&2; exit 1; }

APP_SECRET="$(openssl rand -hex 32)"
POOL="aws-0-ap-south-1.pooler.supabase.com"

cat > .env <<ENV
DATABASE_URL=postgresql://postgres.${REF}:${DBPASS}@${POOL}:6543/postgres?pgbouncer=true&connection_limit=10
DIRECT_URL=postgresql://postgres.${REF}:${DBPASS}@${POOL}:5432/postgres
SUPABASE_URL=https://${REF}.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE}
APP_SECRET=${APP_SECRET}
STORAGE_DRIVER=supabase
ENV
rm -f .dbpass
echo "env written; anon=${ANON:0:10}... service=${SERVICE:0:10}..."
