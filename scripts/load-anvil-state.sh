#!/usr/bin/env bash
set -euo pipefail

SNAPSHOT="${1:-}"
RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"

if [[ -z "$SNAPSHOT" ]]; then
  echo "Usage: $0 <snapshot-file> [rpc-url]" >&2
  echo "  e.g. $0 anvil-snapshot-2026-04-25T12-29-26.json" >&2
  exit 2
fi

if [[ ! -f "$SNAPSHOT" ]]; then
  echo "Snapshot not found: $SNAPSHOT" >&2
  exit 1
fi

REQ_FILE="$(mktemp -t anvil-load-XXXXXX.json)"
trap 'rm -f "$REQ_FILE"' EXIT

node -e "
  const fs = require('fs');
  const state = fs.readFileSync(process.argv[1], 'utf8').trim();
  fs.writeFileSync(process.argv[2], JSON.stringify({jsonrpc:'2.0',method:'anvil_loadState',params:[state],id:1}));
" "$SNAPSHOT" "$REQ_FILE"

RESP="$(curl -sS -X POST -H 'Content-Type: application/json' --data-binary @"$REQ_FILE" "$RPC_URL")"
echo "$RESP"

# Exit non-zero if Anvil reported an error or didn't return result:true
if ! echo "$RESP" | grep -q '"result":true'; then
  exit 1
fi
