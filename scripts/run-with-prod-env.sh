#!/bin/bash
# Run a command with the decrypted production env loaded (from /tmp/vercel-env.json).
# Usage: bash scripts/run-with-prod-env.sh <command...>
set -euo pipefail
cd /home/z/my-project

eval "$(python3 - <<'PY'
import json, shlex
env = json.load(open('/tmp/vercel-env.json'))
for k in ('DATABASE_URL', 'DIRECT_URL', 'APP_SECRET', 'CRON_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'STORAGE_DRIVER'):
    if k in env:
        print(f'export {k}={shlex.quote(env[k])}')
PY
)"

exec "$@"
