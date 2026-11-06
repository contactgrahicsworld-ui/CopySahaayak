#!/bin/bash
# Restore local .env from Vercel project env vars (runs each session)
set -e
TOKEN_FILE="/home/z/my-project/.vercel-token"
TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '[:space:]')
if [[ -z "$TOKEN" ]]; then echo "missing $TOKEN_FILE"; exit 1; fi
TEAM="team_kjzlL9oti3ciMWtCz2ye5IHy"
PROJ="prj_DvUIS0wkM6pqy0nrRJDLgyWLzDZw"
OUT="/home/z/my-project/.env"

echo "Fetching env list..."
LIST=$(curl -s "https://api.vercel.com/v9/projects/${PROJ}/env?teamId=${TEAM}" \
  -H "Authorization: Bearer ${TOKEN}")

echo "$LIST" | python3 -c "
import json,sys
data=json.load(sys.stdin)
envs=data.get('envs',[])
print('Found', len(envs), 'env vars:', ', '.join(e['key'] for e in envs))
" 

# Fetch each env value (works for plain + sensitive)
rm -f "$OUT"
echo "$LIST" | python3 -c "
import json,sys,subprocess
TOKEN='$TOKEN'; TEAM='$TEAM'; PROJ='$PROJ'; OUT='$OUT'
data=json.load(sys.stdin)
lines=[]
for e in data.get('envs',[]):
    key=e['key']; eid=e['id']
    r=subprocess.run(['curl','-s',f'https://api.vercel.com/v9/projects/{PROJ}/env/{eid}?teamId={TEAM}','-H',f'Authorization: Bearer {TOKEN}'],capture_output=True,text=True)
    try:
        val=json.loads(r.stdout).get('value','')
    except Exception:
        val=''
    if val:
        lines.append(f'{key}={val}')
open(OUT,'w').write('\n'.join(lines)+'\n')
print('Wrote', len(lines), 'vars to', OUT)
"
chmod 600 "$OUT"
echo "--- keys present ---"
grep -o '^[A-Z_]*' "$OUT" | sort
