#!/usr/bin/env bash
# .devcontainer/post-create.sh
# ─────────────────────────────────────────────────────────────────
# Runs automatically after the Codespace is created.
# Installs deps, compiles contracts, starts Hardhat node, deploys,
# seeds, and launches the frontend — fully automated.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

echo "══════════════════════════════════════════════════"
echo "  HKSTP TokenHub — Codespaces Setup"
echo "══════════════════════════════════════════════════"

# ── 1. Install Node dependencies ────────────────────────────────
echo ""
echo "▶ Installing Hardhat + frontend dependencies..."
npm ci
cd frontend && npm ci && cd ..

# ── 2. Compile Solidity contracts ────────────────────────────────
echo ""
echo "▶ Compiling Solidity contracts..."
npx hardhat compile

# ── 3. Start Hardhat Network node (background) ──────────────────
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

# ── 4. Deploy all contracts ──────────────────────────────────────
echo ""
echo "▶ Deploying all contracts (12 contracts + roles + frontend auto-update)..."
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

# ── 5. Deploy OrderBook ─────────────────────────────────────────
echo ""
echo "▶ Deploying OrderBook..."
npx hardhat run scripts/deploy-orderbook.js --network localhost

# ── 6. Deploy SystemHealthCheck ──────────────────────────────────
echo ""
echo "▶ Deploying SystemHealthCheck..."
npx hardhat run scripts/deploy-health-check.js --network localhost || echo "  ⚠ SystemHealthCheck deploy skipped (optional)"

# ── 7. Seed investor ────────────────────────────────────────────
echo ""
echo "▶ Seeding Investor1 (KYC + tokens)..."
npx hardhat run scripts/seed-investor.js --network localhost || echo "  ⚠ Seed investor skipped (optional)"

# ── 8. Start frontend (background) ──────────────────────────────
echo ""
echo "▶ Starting Vite dev server..."
cd frontend
nohup npx vite --host 0.0.0.0 --port 3000 > ../frontend-dev.log 2>&1 &
cd ..
echo "  ✓ Frontend PID: $!"

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅ Setup complete!"
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
