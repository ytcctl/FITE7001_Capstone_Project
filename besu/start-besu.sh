#!/bin/bash
# start-besu.sh — Start a single-node Hyperledger Besu devnet via Docker
#
# This uses a custom genesis (Cancun EVM at block 0) with the Engine API
# exposed so that block-producer.js can forge blocks on demand.
#
# Usage:
#   ./besu/start-besu.sh          # Foreground
#   ./besu/start-besu.sh -d       # Detached (background)
#
# After starting Besu, launch the block producer in another terminal:
#   node besu/block-producer.js --interval 1000
#
# Stop:
#   docker stop tokenhub-besu && docker rm tokenhub-besu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTAINER_NAME="tokenhub-besu"
GENESIS_PATH="$SCRIPT_DIR/genesis.json"
DETACH_FLAG=""

if [ "$1" = "-d" ] || [ "$1" = "--detach" ]; then
  DETACH_FLAG="-d"
fi

# Remove existing container
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting Hyperledger Besu (Cancun, chain ID 7001)..."
echo "  RPC    : http://127.0.0.1:8545"
echo "  WS     : ws://127.0.0.1:8546"
echo "  Engine : http://127.0.0.1:8551"

docker run $DETACH_FLAG \
  --name "$CONTAINER_NAME" \
  -p 8545:8545 \
  -p 8546:8546 \
  -p 8551:8551 \
  -v "$GENESIS_PATH:/opt/besu/genesis.json" \
  hyperledger/besu:latest \
  --genesis-file=/opt/besu/genesis.json \
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
  echo "Now start the block producer:"
  echo "  node besu/block-producer.js --interval 1000"
  echo ""
  echo "Logs:   docker logs -f $CONTAINER_NAME"
  echo "Stop:   docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME"
fi
