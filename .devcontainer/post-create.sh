#!/usr/bin/env bash
# .devcontainer/post-create.sh
# ─────────────────────────────────────────────────────────────────
# Runs automatically after the Codespace is created.
# Installs deps, compiles contracts, starts Besu, deploys, seeds,
# and launches the frontend — fully automated.
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

# ── 3. Start Besu via Docker ────────────────────────────────────
echo ""
echo "▶ Starting Hyperledger Besu (Cancun, chain ID 7001)..."
bash besu/start-besu.sh -d

# Wait for Besu RPC to be reachable
echo "  Waiting for Besu RPC..."
for i in $(seq 1 30); do
  if curl -sf -X POST http://127.0.0.1:8545 \
       -H "Content-Type: application/json" \
       -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
       > /dev/null 2>&1; then
    echo "  ✓ Besu RPC ready (attempt $i)"
    break
  fi
  sleep 2
done

# ── 4. Start block producer (background) ────────────────────────
echo ""
echo "▶ Starting block producer (Engine API)..."
nohup node besu/block-producer.js --interval 1000 > besu/producer.log 2>&1 &
echo "  ✓ Block producer PID: $!"
sleep 2

# ── 5. Deploy contracts ─────────────────────────────────────────
echo ""
echo "▶ Deploying all contracts to Besu..."
npx hardhat run scripts/deploy-and-update-frontend.js --network besu

# ── 6. Deploy SystemHealthCheck ──────────────────────────────────
echo ""
echo "▶ Deploying SystemHealthCheck..."
npx hardhat run scripts/deploy-health-check.js --network besu

# ── 7. Seed investor ────────────────────────────────────────────
echo ""
echo "▶ Seeding Investor1 (KYC + tokens)..."
npx hardhat run scripts/seed-investor.js --network besu

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
echo "  Besu RPC : http://localhost:8545"
echo "  Chain ID : 7001"
echo ""
echo "  Admin PK  : 0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63"
echo "  Admin Addr: 0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73"
echo ""
echo "  Investor1 : 0x5e33E2E5333DD9b7b428AC38AE361E9b707046f3"
echo "  HKSAT     : 10,000     THKD: 5,000,000"
echo "══════════════════════════════════════════════════"
