/**
 * @title deploy-besu.js
 * @notice All-in-one deployment launcher.
 *
 * Workflow:
 *   1. Checks if a node is already running on port 8545.
 *   2. If not, spawns `npx hardhat node` as a managed child process.
 *   3. If Besu Engine API is found on port 8551, spawns the block producer.
 *   4. Runs `npx hardhat run scripts/deploy.js --network localhost`.
 *   5. Leaves the Hardhat node running (or cleans up block producer).
 *
 * Usage (from project root):
 *   node scripts/deploy-besu.js
 */

const { spawn, execSync } = require("child_process");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BP_SCRIPT = path.join(PROJECT_ROOT, "besu", "block-producer.js");
const ETH_URL = process.env.ETH_URL || "http://127.0.0.1:8545";
const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:8551";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function rpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  return (await res.json()).result;
}

async function currentBlock() {
  const hex = await rpc(ETH_URL, "eth_blockNumber");
  return parseInt(hex, 16);
}

async function hasEngineAPI() {
  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "engine_exchangeCapabilities",
        params: [["engine_forkchoiceUpdatedV3"]], id: 1,
      }),
      signal: AbortSignal.timeout(2000),
    });
    const json = await res.json();
    return !json.error;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  TokenHub — Deployment Launcher");
  console.log("═══════════════════════════════════════════════════════\n");

  let nodeProcess = null; // managed Hardhat node (if we spawned it)

  // ── 1. Check if a node is already running on port 8545 ──────────────────
  let startBlock;
  let nodeAlreadyRunning = false;
  try {
    startBlock = await currentBlock();
    nodeAlreadyRunning = true;
    console.log(`✓ RPC reachable — current block #${startBlock}`);
  } catch {
    // No node running — spawn Hardhat node
    console.log("No node running on port 8545 — starting Hardhat Network...");
    nodeProcess = spawn("npx", ["hardhat", "node"], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      detached: false,
    });
    nodeProcess.stdout.on("data", (d) => {
      const text = d.toString();
      if (text.includes("Started HTTP")) {
        console.log("✓ Hardhat Network started on http://127.0.0.1:8545");
      }
    });
    nodeProcess.stderr.on("data", (d) => {
      const text = d.toString().trim();
      if (text) console.error(`  [node:err] ${text}`);
    });

    // Wait for the node to be ready
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      try {
        startBlock = await currentBlock();
        console.log(`✓ Hardhat Network ready — block #${startBlock}`);
        break;
      } catch { /* retry */ }
    }
    if (startBlock === undefined) {
      console.error("✗ Failed to start Hardhat node. Aborting.");
      if (nodeProcess) nodeProcess.kill();
      process.exit(1);
    }
  }

  // ── 2. Detect back-end (Besu Engine API vs Hardhat auto-mine) ───────────
  const isBesu = await hasEngineAPI();
  let bp = null;

  if (isBesu) {
    console.log("  Mode: Besu + Engine API (block producer required)");
    console.log("\nSpawning block producer...");
    bp = spawn("node", [BP_SCRIPT, "--interval", "800"], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    bp.stdout.on("data", (d) => {
      for (const line of d.toString().split("\n").filter(Boolean))
        console.log(`  [bp] ${line}`);
    });
    bp.stderr.on("data", (d) => {
      for (const line of d.toString().split("\n").filter(Boolean))
        console.error(`  [bp:err] ${line}`);
    });
    bp.on("exit", (code) => {
      if (code !== null && code !== 0)
        console.error(`\n✗ Block producer exited unexpectedly (code ${code})`);
    });

    console.log("Waiting for block production...");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      try {
        const now = await currentBlock();
        if (now > startBlock) { ready = true; break; }
      } catch { /* retry */ }
    }
    if (!ready)
      console.log("⚠ No new block yet (no pending txs) — proceeding anyway.\n");
    else
      console.log(`✓ Block production confirmed\n`);
  } else {
    console.log("  Mode: Hardhat Network (auto-mine)\n");
  }

  // ── 3. Run Hardhat deploy ───────────────────────────────────────────────
  console.log("Running Hardhat deployment...\n");
  const deploy = spawn(
    "npx",
    ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"],
    {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        BESU_CHAIN_ID: process.env.BESU_CHAIN_ID || "31337",
      },
      shell: true,
    }
  );

  const deployCode = await new Promise((resolve) => {
    deploy.on("exit", resolve);
  });

  // ── 4. Clean up block producer (if any) ─────────────────────────────────
  if (bp) {
    console.log("\nStopping block producer...");
    bp.kill("SIGTERM");
    await sleep(500);
    if (!bp.killed) bp.kill("SIGKILL");
  }

  if (deployCode === 0) {
    console.log("\n✓ Deployment completed successfully!");
    if (nodeProcess) {
      console.log("\n  Hardhat node is still running on http://127.0.0.1:8545");
      console.log("  Press Ctrl+C in the node terminal to stop it.\n");
    }
  } else {
    console.error(`\n✗ Deployment failed (exit code ${deployCode})`);
    if (nodeProcess) nodeProcess.kill();
  }

  process.exit(deployCode || 0);
})();
