#!/usr/bin/env bash
# .devcontainer/post-create.sh
# ─────────────────────────────────────────────────────────────────
# Runs ONCE when the Codespace is first created.
# Installs dependencies and compiles contracts.
# The actual services (Hardhat node, deploy, frontend) are started
# by start.sh which runs on every Codespace start/restart.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

echo "══════════════════════════════════════════════════"
echo "  HKSTP TokenHub — One-time Setup"
echo "══════════════════════════════════════════════════"

# ── 1. Install Node dependencies ────────────────────────────────
echo ""
echo "▶ Installing Hardhat + frontend dependencies..."
npm ci
cd frontend && npm ci && cd ..

# ── 2. Install Foundry (Anvil — persistent local devnet) ─────────
echo ""
echo "▶ Installing Foundry (Anvil)..."
curl -L https://foundry.paradigm.xyz | bash
export PATH="$HOME/.foundry/bin:$PATH"
foundryup
echo "  ✓ Anvil $(anvil --version | head -1)"

# ── 3. Compile Solidity contracts ────────────────────────────────
echo ""
echo "▶ Compiling Solidity contracts..."
npx hardhat compile

echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅ One-time setup complete!"
echo "  Services will start automatically via start.sh..."
echo "══════════════════════════════════════════════════"
