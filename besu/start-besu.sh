#!/bin/bash
# start-besu.sh — Start a single-node Hyperledger Besu devnet via Docker
#
# This uses a custom genesis (Cancun EVM at block 0) with the Engine API
# exposed so that block-producer.js can forge blocks on demand.
#
# Chain data is persisted to besu/data/ so that contracts, state, and
# balances survive container restarts.
#
# Usage:
#   ./besu/start-besu.sh              # Foreground
#   ./besu/start-besu.sh -d           # Detached (background)
#   ./besu/start-besu.sh -d --reset   # Wipe chain data and start fresh
#
# After starting Besu, launch the block producer in another terminal:
#   node besu/block-producer.js --interval 1000
#
# Stop:
#   docker stop tokenhub-besu
#
# Restart (data preserved):
#   docker start tokenhub-besu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTAINER_NAME="tokenhub-besu"
GENESIS_PATH="$SCRIPT_DIR/genesis.json"
DATA_PATH="$SCRIPT_DIR/data"
DETACH_FLAG=""
RESET=false

for arg in "$@"; do
  case $arg in
    -d|--detach) DETACH_FLAG="-d" ;;
    --reset)     RESET=true ;;
  esac
done

# Optionally wipe chain data for a fresh start
if [ "$RESET" = true ]; then
  echo "Resetting chain data (wiping $DATA_PATH)..."
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
  rm -rf "$DATA_PATH"
  echo "  Chain data wiped. Starting fresh."
fi

# Create data directory if it doesn't exist
mkdir -p "$DATA_PATH"

# Remove existing container
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting Hyperledger Besu (Cancun, chain ID 7001)..."
echo "  RPC    : http://127.0.0.1:8545"
echo "  WS     : ws://127.0.0.1:8546"
echo "  Engine : http://127.0.0.1:8551"
echo "  Data   : $DATA_PATH"

docker run $DETACH_FLAG \
  --name "$CONTAINER_NAME" \
  -p 8545:8545 \
  -p 8546:8546 \
  -p 8551:8551 \
  -v "$GENESIS_PATH:/opt/besu/genesis.json" \
  -v "$DATA_PATH:/opt/besu/data" \
  hyperledger/besu:latest \
  --genesis-file=/opt/besu/genesis.json \
  --data-path=/opt/besu/data \
  --rpc-http-enabled \
  --rpc-http-api=ETH,NET,WEB3,DEBUG,ADMIN,TXPOOL \
  --rpc-http-cors-origins="*" \
  --rpc-http-host=0.0.0.0 \
  --rpc-ws-enabled \
  --rpc-ws-api=ETH,NET,WEB3 \
  --rpc-ws-host=0.0.0.0 \
  --host-allowlist="*" \
  --engine-jwt-disabled \
  --engine-rpc-enabled \
  --min-gas-price=0 \
  --logging=INFO

if [ -n "$DETACH_FLAG" ]; then
  echo ""
  echo "Besu node started in background. Container: $CONTAINER_NAME"
  echo "Chain data persisted to: $DATA_PATH"
  echo ""
  echo "Now start the block producer:"
  echo "  node besu/block-producer.js --interval 1000"
  echo ""
  echo "Logs:    docker logs -f $CONTAINER_NAME"
  echo "Stop:    docker stop $CONTAINER_NAME"
  echo "Restart: docker start $CONTAINER_NAME"
  echo "Reset:   ./besu/start-besu.sh -d --reset"
fi
