#!/bin/bash
# Deploy a commit SHA to Vercel production and poll until READY (or ERROR).
set -e
SHA="$1"
TOKEN=$(cat /home/z/my-project/.vercel-token 2>/dev/null | tr -d '[:space:]')
if [[ -z "$TOKEN" ]]; then echo "missing /home/z/my-project/.vercel-token"; exit 1; fi
TEAM="team_kjzlL9oti3ciMWtCz2ye5IHy"
if [[ -z "$SHA" ]]; then echo "usage: deploy.sh <sha>"; exit 1; fi
RESP=$(curl -s -X POST "https://api.vercel.com/v13/deployments?teamId=${TEAM}&skipAutoDetectionConfirmation=1" \
  -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d "{\"name\":\"copysahaayak\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"repoId\":1442824032,\"ref\":\"${SHA}\"}}")
DEPLOY_ID=$(echo "$RESP" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))")
if [[ -z "$DEPLOY_ID" ]]; then echo "DEPLOY CREATE FAILED: $RESP"; exit 1; fi
echo "deployment: $DEPLOY_ID"
for i in $(seq 1 120); do
  sleep 10
  ST=$(curl -s "https://api.vercel.com/v13/deployments/${DEPLOY_ID}?teamId=${TEAM}" -H "Authorization: Bearer ${TOKEN}" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('readyState'),d.get('ready',-1))")
  echo "  poll $i: $ST"
  if [[ "$ST" == READY* ]]; then echo "DEPLOY READY: $DEPLOY_ID"; exit 0; fi
  if [[ "$ST" == ERROR* || "$ST" == CANCELED* ]]; then echo "DEPLOY FAILED: $ST"; exit 1; fi
done
echo "TIMEOUT waiting for deployment"; exit 1
