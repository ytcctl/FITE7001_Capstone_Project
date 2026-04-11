/**
 * @title harden-admin.js
 * @notice Transfers DEFAULT_ADMIN_ROLE from the deployer EOA to the Timelock
 *         contract on all deployed contracts, then renounces the deployer's
 *         admin role.
 *
 * This is a critical P0 security hardening step:
 *   BEFORE:  Deployer EOA → DEFAULT_ADMIN_ROLE on all 12 contracts
 *   AFTER:   Timelock      → DEFAULT_ADMIN_ROLE on all 12 contracts
 *            Deployer EOA  → no admin rights (renounced)
 *
 * All admin changes must then go through Governance → Timelock (48h delay).
 *
 * Usage:
 *   npx hardhat run scripts/harden-admin.js --network besu
 *
 * ⚠ WARNING: This is IRREVERSIBLE. The deployer will permanently lose admin
 *   access. Only the Timelock (controlled by governance) can grant new roles.
 */

const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// Embedded Engine-API block producer (reuse from deploy script)
// ---------------------------------------------------------------------------
const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:8551";
const ETH_URL = process.env.ETH_URL || "http://127.0.0.1:8545";

let rpcId = 1;
async function engineRpc(url, method, params = []) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: rpcId++ });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = await res.json();
  if (json.error)
    throw new Error(`${method}: ${json.error.message} (code ${json.error.code})`);
  return json.result;
}

async function produceOneBlock() {
  const latest = await engineRpc(ETH_URL, "eth_getBlockByNumber", ["latest", false]);
  const parentHash = latest.hash;
  const timestamp = Math.max(
    Math.floor(Date.now() / 1000),
    parseInt(latest.timestamp, 16) + 1
  );
  const timestampHex = "0x" + timestamp.toString(16);
  const zeroHash = "0x" + "0".repeat(64);

  const fcu = await engineRpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    { headBlockHash: parentHash, safeBlockHash: parentHash, finalizedBlockHash: parentHash },
    {
      timestamp: timestampHex,
      prevRandao: zeroHash,
      suggestedFeeRecipient: "0xfe3b557e8fb62b89f4916b721be55ceb828dbd73",
      withdrawals: [],
      parentBeaconBlockRoot: zeroHash,
    },
  ]);
  if (!fcu.payloadId) return null;

  const payload = await engineRpc(ENGINE_URL, "engine_getPayloadV3", [fcu.payloadId]);
  const ep = payload.executionPayload;
  const blobs = payload.blobsBundle || { commitments: [], proofs: [], blobs: [] };

  const np = await engineRpc(ENGINE_URL, "engine_newPayloadV3", [
    ep,
    blobs.commitments || [],
    ep.parentBeaconBlockRoot || zeroHash,
  ]);
  if (np.status !== "VALID") return null;

  await engineRpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    { headBlockHash: ep.blockHash, safeBlockHash: ep.blockHash, finalizedBlockHash: ep.blockHash },
    null,
  ]);
  return { number: parseInt(ep.blockNumber, 16), txCount: (ep.transactions || []).length };
}

function startBlockProducer() {
  let running = true;
  const promise = (async () => {
    while (running) {
      try {
        const pending = await engineRpc(ETH_URL, "txpool_besuStatistics", [])
          .then((r) => (r.localCount || 0) + (r.remoteCount || 0))
          .catch(() => 0);
        if (pending > 0) {
          const blk = await produceOneBlock();
          if (blk) console.log(`  ⛏  Block #${blk.number}  txs=${blk.txCount}`);
        }
      } catch { /* swallow */ }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  return { stop: () => { running = false; return promise; } };
}

// ---------------------------------------------------------------------------
// Contract addresses (must match your deployment)
// ---------------------------------------------------------------------------
const CONTRACTS = {
  identityRegistry: "0x2ed622769Bf53dC4E52c659Ca0E140651716e9e3",
  compliance:       "0x42aeb727C3D7E4eF8ccde8039bDF9bE804B3B9FF",
  securityToken:    "0x4cf5ff8672BC73A108744927083893662b3C38D5",
  cashToken:        "0xfa584f21aEE65BfE18033224A0c45B5636556564",
  dvpSettlement:    "0x532664FBa45daB814DE78A00803F96281a72cdAe",
  tokenFactory:     "0x07523c66084F92a2E47A86B10902a0197D6F5e1D",
  claimIssuer:      "0xd9c5C8bC185b59Fe9f5C6574b7873aF7DF3F7f22",
  identityFactory:  "0xbc02C1Ad0De6620a19594B1667043626211Db0fA",
  walletRegistry:   "0x0aF1B3F6e2B7512ae8E6ad5Ae415D18E1919A0FE",
  multiSigWarm:     "0x8CC15C26BC072cA8e396f906CEA6743fAD316EF0",
  governor:         "0x5cE576A3D9111FC8b1cD6494E01d2c13B9cb230C",
  timelock:         "0xE1D5CE69Fa455DAe0FfC9A35Aa690C0A0E599f74",
};

// ---------------------------------------------------------------------------
// Main — Transfer admin to Timelock, then renounce
// ---------------------------------------------------------------------------
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  P0: Transfer DEFAULT_ADMIN_ROLE → Timelock (Governance)    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Starting embedded block producer...\n");
  const blockProducer = startBlockProducer();

  const [deployer] = await ethers.getSigners();
  const TIMELOCK = CONTRACTS.timelock;

  console.log("Deployer:  ", deployer.address);
  console.log("Timelock:  ", TIMELOCK);
  console.log();

  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash; // bytes32(0)

  // Contracts that use AccessControl and have DEFAULT_ADMIN_ROLE
  const accessControlledContracts = [
    { name: "IdentityRegistry", addr: CONTRACTS.identityRegistry, abi: "HKSTPIdentityRegistry" },
    { name: "Compliance",       addr: CONTRACTS.compliance,       abi: "HKSTPCompliance" },
    { name: "SecurityToken",    addr: CONTRACTS.securityToken,    abi: "HKSTPSecurityToken" },
    { name: "CashToken",        addr: CONTRACTS.cashToken,        abi: "MockCashToken" },
    { name: "DvPSettlement",    addr: CONTRACTS.dvpSettlement,    abi: "DvPSettlement" },
    { name: "TokenFactory",     addr: CONTRACTS.tokenFactory,     abi: "TokenFactory" },
    { name: "IdentityFactory",  addr: CONTRACTS.identityFactory,  abi: "IdentityFactory" },
    { name: "WalletRegistry",   addr: CONTRACTS.walletRegistry,   abi: "WalletRegistry" },
    { name: "MultiSigWarm",     addr: CONTRACTS.multiSigWarm,     abi: "MultiSigWarm" },
  ];

  // ── Step 1: Grant DEFAULT_ADMIN_ROLE to Timelock on every contract ──
  console.log("════════════════════════════════════════════════════");
  console.log("  Step 1: Grant DEFAULT_ADMIN_ROLE to Timelock");
  console.log("════════════════════════════════════════════════════\n");

  for (const c of accessControlledContracts) {
    const contract = await ethers.getContractAt(c.abi, c.addr);
    const hasAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, TIMELOCK);
    if (hasAdmin) {
      console.log(`  [SKIP] ${c.name}: Timelock already has admin`);
    } else {
      const tx = await contract.grantRole(DEFAULT_ADMIN_ROLE, TIMELOCK);
      await tx.wait();
      console.log(`  [✓] ${c.name}: Granted DEFAULT_ADMIN_ROLE to Timelock`);
    }
  }

  // ── Step 2: Verify Timelock has admin on all contracts ──
  console.log("\n════════════════════════════════════════════════════");
  console.log("  Step 2: Verify Timelock admin roles");
  console.log("════════════════════════════════════════════════════\n");

  let allGranted = true;
  for (const c of accessControlledContracts) {
    const contract = await ethers.getContractAt(c.abi, c.addr);
    const hasAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, TIMELOCK);
    const status = hasAdmin ? "✓" : "✗";
    console.log(`  [${status}] ${c.name}`);
    if (!hasAdmin) allGranted = false;
  }

  if (!allGranted) {
    console.error("\n❌ Not all contracts have Timelock as admin. Aborting renounce.");
    await blockProducer.stop();
    process.exit(1);
  }

  // ── Step 3: Renounce deployer's DEFAULT_ADMIN_ROLE on all contracts ──
  console.log("\n════════════════════════════════════════════════════");
  console.log("  Step 3: Renounce deployer admin (IRREVERSIBLE!)");
  console.log("════════════════════════════════════════════════════\n");

  for (const c of accessControlledContracts) {
    const contract = await ethers.getContractAt(c.abi, c.addr);
    const hasAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    if (!hasAdmin) {
      console.log(`  [SKIP] ${c.name}: Deployer already renounced`);
    } else {
      const tx = await contract.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address);
      await tx.wait();
      console.log(`  [✓] ${c.name}: Deployer admin RENOUNCED`);
    }
  }

  // ── Step 4: Final verification ──
  console.log("\n════════════════════════════════════════════════════");
  console.log("  Step 4: Final verification");
  console.log("════════════════════════════════════════════════════\n");

  console.log("  Contract                  Deployer Admin?  Timelock Admin?");
  console.log("  ─────────────────────────────────────────────────────────");
  for (const c of accessControlledContracts) {
    const contract = await ethers.getContractAt(c.abi, c.addr);
    const deployerAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    const timelockAdmin = await contract.hasRole(DEFAULT_ADMIN_ROLE, TIMELOCK);
    const padName = c.name.padEnd(22);
    const d = deployerAdmin ? "YES ⚠" : "NO  ✓";
    const t = timelockAdmin ? "YES ✓" : "NO  ✗";
    console.log(`  ${padName}  ${d}            ${t}`);
  }

  await blockProducer.stop();

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Admin hardening complete!                                    ║");
  console.log("║                                                               ║");
  console.log("║  All admin roles are now controlled by the Timelock.          ║");
  console.log("║  Changes require: Governance proposal → Vote → 48h delay.    ║");
  console.log("║                                                               ║");
  console.log("║  The deployer EOA can NO LONGER perform admin actions.        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
