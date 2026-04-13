/**
 * @title deploy-besu.js
 * @notice All-in-one Besu deployment launcher.
 *
 * 1. Spawns the Engine-API block producer as a child process.
 * 2. Waits until the block producer is producing blocks.
 * 3. Runs `npx hardhat run scripts/deploy.js --network besu`.
 * 4. Kills the block producer and exits.
 *
 * Usage (from project root):
 *   node scripts/deploy-besu.js
 */

const { spawn } = require("child_process");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const BP_SCRIPT = path.join(PROJECT_ROOT, "besu", "block-producer.js");
const ETH_URL = process.env.ETH_URL || "http://127.0.0.1:8545";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function rpc(method, params = []) {
  const res = await fetch(ETH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  return (await res.json()).result;
}

async function currentBlock() {
  const hex = await rpc("eth_blockNumber");
  return parseInt(hex, 16);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  TokenHub — Besu Deployment Launcher");
  console.log("═══════════════════════════════════════════════════════\n");

  // ── 1. Check Besu is reachable ──────────────────────────────────────────
  let startBlock;
  try {
    startBlock = await currentBlock();
    console.log(`✓ Besu RPC reachable — current block #${startBlock}`);
  } catch (err) {
    console.error("✗ Cannot reach Besu RPC at", ETH_URL);
    console.error("  Make sure the Besu container is running:");
    console.error("    .\\besu\\start-besu.ps1 -Detach\n");
    process.exit(1);
  }

  // ── 2. Spawn block producer ─────────────────────────────────────────────
  console.log("\nSpawning block producer...");
  const bp = spawn("node", [BP_SCRIPT, "--interval", "800"], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  // Relay block-producer stdout/stderr with a prefix
  bp.stdout.on("data", (d) => {
    for (const line of d.toString().split("\n").filter(Boolean)) {
      console.log(`  [bp] ${line}`);
    }
  });
  bp.stderr.on("data", (d) => {
    for (const line of d.toString().split("\n").filter(Boolean)) {
      console.error(`  [bp:err] ${line}`);
    }
  });

  bp.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`\n✗ Block producer exited unexpectedly (code ${code})`);
    }
  });

  // ── 3. Wait for at least one new block ──────────────────────────────────
  console.log("Waiting for block production...");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const now = await currentBlock();
      if (now > startBlock) {
        console.log(`✓ Block production confirmed — block #${now}\n`);
        ready = true;
        break;
      }
    } catch { /* retry */ }
  }

  if (!ready) {
    // Even if no *new* block was produced (0 pending txs), the producer is
    // running and will produce blocks as soon as txs arrive. Proceed anyway.
    console.log("⚠ No new block yet (no pending txs) — proceeding anyway.\n");
  }

  // ── 4. Run Hardhat deploy ───────────────────────────────────────────────
  console.log("Running Hardhat deployment...\n");
  const deploy = spawn(
    "npx",
    ["hardhat", "run", "scripts/deploy.js", "--network", "besu"],
    {
      cwd: PROJECT_ROOT,
      stdio: "inherit",            // connect directly to our stdout/stderr
      env: { ...process.env },
      shell: true,                 // required on Windows to resolve npx.cmd
    }
  );

  const deployCode = await new Promise((resolve) => {
    deploy.on("exit", resolve);
  });

  // ── 5. Clean up ─────────────────────────────────────────────────────────
  console.log("\nStopping block producer...");
  bp.kill("SIGTERM");
  // Give it a moment to exit gracefully
  await sleep(500);
  if (!bp.killed) bp.kill("SIGKILL");

  if (deployCode === 0) {
    console.log("\n✓ Deployment completed successfully!");
  } else {
    console.error(`\n✗ Deployment failed (exit code ${deployCode})`);
  }

  process.exit(deployCode || 0);
})();
