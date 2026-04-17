#!/usr/bin/env bash
# .devcontainer/start.sh
# ─────────────────────────────────────────────────────────────────
# Runs on EVERY Codespace start / restart / resume.
# Uses Anvil (Foundry) with --dump-state / --load-state so ALL
# blockchain data (trades, orders, delegations, proposals) persists
# across Codespace restarts.
# ─────────────────────────────────────────────────────────────────
set -uo pipefail   # no -e: let the script keep going even if a step fails

# Ensure Foundry binaries are on PATH
export PATH="$HOME/.foundry/bin:$PATH"

STATE_FILE="/workspaces/FITE7001_Capstone_Project/.devcontainer/anvil-state.json"

# Dev-mode addresses that need funding (same as Besu dev accounts)
DEV_ADDRS=(
  "0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73"
  "0x627306090abaB3A6e1400e9345bC60c78a8BEf57"
  "0xf17f52151EbEF6C7334FAD080c5704D77216b732"
  "0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef"
  "0x821aEa9a577a9b44299B9c15c88cf3087F3b5544"
)

echo ""
echo "══════════════════════════════════════════════════"
echo "  HKSTP TokenHub — Starting services..."
echo "══════════════════════════════════════════════════"

# ── Kill any leftover processes from previous session ────────────
echo ""
echo "▶ Cleaning up stale processes..."
pkill -f "hardhat node" 2>/dev/null || true
pkill -f "anvil" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
# Force-kill anything stuck on our ports
fuser -k 8545/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 1

# ── 1. Start Anvil (persistent local devnet) ────────────────────
echo ""
ANVIL_ARGS=(
  --host 0.0.0.0
  --port 8545
  --chain-id 31337
  --accounts 10                   # generate 10 default HD accounts
  --balance 1000000               # 1M ETH each
  --dump-state "$STATE_FILE"      # auto-save state on shutdown
)

# Fund dev accounts via anvil_setBalance cheat code
fund_dev_accounts() {
  echo "  Funding dev accounts..."
  for addr in "${DEV_ADDRS[@]}"; do
    curl -sf -X POST http://127.0.0.1:8545 \
      -H "Content-Type: application/json" \
      -d "{\"jsonrpc\":\"2.0\",\"method\":\"anvil_setBalance\",\"params\":[\"$addr\",\"0xD3C21BCECCEDA1000000\"],\"id\":1}" \
      > /dev/null 2>&1
  done
  echo "  ✓ Dev accounts funded (1M ETH each)"
}

if [ -f "$STATE_FILE" ]; then
  echo "▶ Found saved chain state — restoring from snapshot..."
  ANVIL_ARGS+=(--load-state "$STATE_FILE")
  nohup anvil "${ANVIL_ARGS[@]}" > anvil-node.log 2>&1 &
  ANVIL_PID=$!
  echo "  Anvil PID: $ANVIL_PID"

  # Wait for Anvil RPC to be reachable
  echo "  Waiting for RPC..."
  for i in $(seq 1 30); do
    if curl -sf -X POST http://127.0.0.1:8545 \
         -H "Content-Type: application/json" \
         -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
         > /dev/null 2>&1; then
      echo "  ✓ Anvil RPC ready (attempt $i)"
      break
    fi
    sleep 2
  done

  fund_dev_accounts
  echo "  ✓ Chain state restored — skipping deployment"
else
  echo "▶ No saved state — starting fresh Anvil instance..."
  nohup anvil "${ANVIL_ARGS[@]}" > anvil-node.log 2>&1 &
  ANVIL_PID=$!
  echo "  Anvil PID: $ANVIL_PID"

  # Wait for Anvil RPC to be reachable
  echo "  Waiting for RPC..."
  for i in $(seq 1 30); do
    if curl -sf -X POST http://127.0.0.1:8545 \
         -H "Content-Type: application/json" \
         -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
         > /dev/null 2>&1; then
      echo "  ✓ Anvil RPC ready (attempt $i)"
      break
    fi
    sleep 2
  done

  fund_dev_accounts

  # ── 2. Deploy all contracts (first time only) ─────────────────
  echo ""
  echo "▶ Deploying all contracts (18 contracts + roles + seed investor + frontend auto-update)..."
  npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

  # ── 2b. Seed additional test data ─────────────────────────────
  echo ""
  echo "▶ Seeding additional test data (Investor2, Investor3, delegations, proposals, orders)..."
  npx hardhat run scripts/seed-all-testdata.js --network localhost || echo "  ⚠ Test data seeding skipped (non-fatal)"

  # ── 3. (Optional) Deploy SystemHealthCheck ─────────────────────
  echo ""
  echo "▶ Verifying SystemHealthCheck..."
  npx hardhat run scripts/deploy-health-check.js --network localhost || echo "  ⚠ SystemHealthCheck deploy skipped"
fi

# ── 4. Start frontend (background) ──────────────────────────────
echo ""
echo "▶ Starting Vite dev server..."
cd /workspaces/FITE7001_Capstone_Project/frontend
npm install --silent 2>/dev/null || true
nohup npx vite --host 0.0.0.0 --port 3000 > /workspaces/FITE7001_Capstone_Project/frontend-dev.log 2>&1 &
VITE_PID=$!
cd /workspaces/FITE7001_Capstone_Project
echo "  ✓ Frontend PID: $VITE_PID"

# Verify Vite actually started
sleep 3
if lsof -i :3000 > /dev/null 2>&1; then
  echo "  ✓ Vite is listening on port 3000"
else
  echo "  ⚠ Vite may still be starting — check frontend-dev.log"
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅ All services running!"
echo ""
echo "  Frontend : http://localhost:3000  (forwarded by Codespaces)"
echo "  RPC      : http://localhost:8545  (Anvil — persistent state)"
echo "  Chain ID : 31337"
echo "  State    : $STATE_FILE"
echo ""
echo "  Admin PK  : 0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63"
echo "  Admin Addr: 0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73"
echo ""
echo "  Use the built-in test accounts in the Connect Wallet dropdown."
echo "  All blockchain data persists across Codespace restarts!"
echo "══════════════════════════════════════════════════"
