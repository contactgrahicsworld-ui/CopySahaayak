#!/bin/bash
# Deploy a given git SHA to Vercel (production) and poll until READY.
set -e
cd /home/z/my-project
TOKEN=$(cat .vercel-token)
SHA="$1"
[ -z "$SHA" ] && SHA=$(git rev-parse HEAD)
echo "Deploying SHA $SHA ..."
RES=$(curl -s -X POST "https://api.vercel.com/v13/deployments?teamId=team_kjzlL9oti3ciMWtCz2ye5IHy&skipAutoDetectionConfirmation=1" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"copysahaayak\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"repoId\":1442824032,\"ref\":\"$SHA\"}}")
DPL=$(echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id') or d.get('error',{}).get('message','ERR'))")
if [[ "$DPL" == dpl_* ]]; then
  echo "Deployment id: $DPL"
else
  echo "Deploy creation failed: $DPL"; exit 1
fi
for i in $(seq 1 90); do
  sleep 10
  ST=$(curl -s "https://api.vercel.com/v13/deployments/$DPL?teamId=team_kjzlL9oti3ciMWtCz2ye5IHy" -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('readyState','?'))")
  echo "[$i] readyState=$ST"
  if [ "$ST" = "READY" ]; then echo "DEPLOY READY: $DPL"; exit 0; fi
  if [ "$ST" = "ERROR" ] || [ "$ST" = "CANCELED" ]; then echo "DEPLOY FAILED: $ST"; exit 1; fi
done
echo "TIMED OUT waiting for deployment"; exit 1
