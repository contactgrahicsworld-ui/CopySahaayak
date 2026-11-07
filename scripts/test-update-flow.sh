#!/usr/bin/env bash
# End-to-end test of the Desktop Sahaayak self-update download path:
#   1. builds a 5 MB test payload and a manifest server (scripts/test-update-server.py)
#   2. runs the REAL connector code (ApiClient.GetLatestVersionAsync +
#      DownloadToFileAsync + SelfUpdater.VerifySha256) against it
#   3. asserts the manifest parse, byte-exact download, progress events and
#      checksum accept/reject behaviour
set -euo pipefail
ROOT="/home/z/my-project"
PORT="${1:-8765}"

# payload: 5 MB of pseudo-random bytes (deterministic)
python3 -c "
import random
random.seed(42)
open('/tmp/update-payload.bin','wb').write(bytes(random.getrandbits(8) for _ in range(5*1024*1024)))
"
echo "==> payload ready (5 MB)"

python3 "$ROOT/scripts/test-update-server.py" "$PORT" /tmp/update-payload.bin &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 1

echo "==> running the connector update-flow E2E test"
export XDG_CONFIG_HOME="/tmp/sut-home"
mkdir -p "$XDG_CONFIG_HOME"
"$HOME/.dotnet/dotnet" run --project "$ROOT/connector/tests/UpdateFlowE2ETest" -- "http://127.0.0.1:$PORT"
