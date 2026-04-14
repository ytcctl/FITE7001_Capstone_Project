#!/usr/bin/env bash
# .devcontainer/start.sh
# ─────────────────────────────────────────────────────────────────
# Runs on EVERY Codespace start / restart / resume.
# Starts Hardhat node, deploys contracts, launches frontend.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

echo ""
echo "══════════════════════════════════════════════════"
echo "  HKSTP TokenHub — Starting services..."
echo "══════════════════════════════════════════════════"

# ── Kill any leftover processes from previous session ────────────
echo ""
echo "▶ Cleaning up stale processes..."
pkill -f "hardhat node" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 1

# ── 1. Start Hardhat Network node (background) ──────────────────
echo ""
echo "▶ Starting Hardhat Network (chain ID 31337, auto-mine)..."
nohup npx hardhat node > hardhat-node.log 2>&1 &
HARDHAT_PID=$!
echo "  Hardhat node PID: $HARDHAT_PID"

# Wait for Hardhat RPC to be reachable
echo "  Waiting for RPC..."
for i in $(seq 1 30); do
  if curl -sf -X POST http://127.0.0.1:8545 \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
       > /dev/null 2>&1; then
    echo "  ✓ Hardhat RPC ready (attempt $i)"
    break
  fi
  sleep 2
done

# ── 2. Deploy all contracts ─────────────────────────────────────
echo ""
echo "▶ Deploying all contracts (17 contracts + roles + seed investor + frontend auto-update)..."
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

# ── 3. (Optional) Deploy SystemHealthCheck ───────────────────────
echo ""
echo "▶ Verifying SystemHealthCheck..."
npx hardhat run scripts/deploy-health-check.js --network localhost || echo "  ⚠ SystemHealthCheck deploy skipped"

# ── 4. Start frontend (background) ──────────────────────────────
echo ""
echo "▶ Starting Vite dev server..."
cd frontend
nohup npx vite --host 0.0.0.0 --port 3000 > ../frontend-dev.log 2>&1 &
cd ..
echo "  ✓ Frontend PID: $!"

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅ All services running!"
echo ""
echo "  Frontend : http://localhost:3000  (forwarded by Codespaces)"
echo "  RPC      : http://localhost:8545  (Hardhat Network)"
echo "  Chain ID : 31337"
echo ""
echo "  Admin PK  : 0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63"
echo "  Admin Addr: 0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73"
echo ""
echo "  Use the built-in test accounts in the Connect Wallet dropdown."
echo "══════════════════════════════════════════════════"
