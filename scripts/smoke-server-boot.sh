#!/usr/bin/env bash
set -euo pipefail

smoke_dir=$(mktemp -d)
server_pid=''
cleanup() {
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
  rm -rf "$smoke_dir"
}
trap cleanup EXIT

PORT=5099 DB_PATH="$smoke_dir/smoke.db" node packages/server/src/index.js &
server_pid=$!

for _ in $(seq 1 30); do
  if curl -sf http://localhost:5099/api/projects >/dev/null; then exit 0; fi
  sleep 0.5
done

echo 'server failed to boot' >&2
exit 1
