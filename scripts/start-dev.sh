#!/usr/bin/env bash
# Start Hardhat node in background, wait for it, then deploy all contracts.
# Usage: bash scripts/start-dev.sh

set -e

echo "🚀 Starting Hardhat node..."
npx hardhat node &
HARDHAT_PID=$!

# Wait for JSON-RPC to become available
echo "⏳ Waiting for Hardhat node (http://127.0.0.1:8545)..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://127.0.0.1:8545; then
    echo "✅ Hardhat node is ready."
    break
  fi
  sleep 1
done

echo "📦 Deploying contracts & updating frontend config..."
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

echo ""
echo "✅ Dev environment is ready. Hardhat node PID: $HARDHAT_PID"
echo "   Press Ctrl+C to stop."

# Keep running until user hits Ctrl+C
wait $HARDHAT_PID
