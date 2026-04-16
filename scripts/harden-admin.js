/**
 * @title harden-admin.js
 * @notice Production hardening script — transfers all privileged roles from
 *         the deployer EOA to the Timelock contract, then renounces the
 *         deployer's roles.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  BEFORE (current state):
 *    Deployer EOA holds on every AccessControl contract:
 *      • DEFAULT_ADMIN_ROLE (can grant/revoke any role, set maxSupply, etc.)
 *      • AGENT_ROLE         (can mint ≤ threshold, burn, freeze, safe-list)
 *    + On SecurityToken specifically:
 *      • No TIMELOCK_MINTER_ROLE is assigned (large mints blocked)
 *
 *  AFTER (post-hardening):
 *    Timelock holds:
 *      • DEFAULT_ADMIN_ROLE on all contracts
 *      • TIMELOCK_MINTER_ROLE on SecurityToken (for governance-approved mints)
 *    Deployer EOA:
 *      • AGENT_ROLE on SecurityToken + IdentityRegistry (kept for day-to-day
 *        custodian operations — burn, freeze, safe-list, small mints)
 *      • NO admin roles anywhere
 *    All admin changes must go through Governance → Timelock (48h delay).
 * ════════════════════════════════════════════════════════════════════════
 *
 * Features:
 *   --dry-run     Print what would happen without sending any transactions.
 *                 Set env var DRY_RUN=1 or pass --dry-run flag.
 *
 * Usage:
 *   # Dry run (preview only):
 *   DRY_RUN=1 npx hardhat run scripts/harden-admin.js --network besu
 *
 *   # Execute for real (IRREVERSIBLE admin renounce!):
 *   npx hardhat run scripts/harden-admin.js --network besu
 *
 * ⚠ WARNING: Renouncing DEFAULT_ADMIN_ROLE is IRREVERSIBLE.
 *   The deployer will permanently lose admin access.
 *   Only the Timelock (controlled by governance) can grant new roles.
 */

const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DRY_RUN = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");

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
// Contract addresses (must match your deployment — update after redeploy)
// ---------------------------------------------------------------------------
const CONTRACTS = {
  securityToken:    "0x6aA8b700cD034Ab4B897B59447f268b33B8cF699",
  identityRegistry: "0x619A83c9368aDa9fFb98c3F14b662724dD19E943",
  compliance:       "0x7eF84473a4E772fB6aDfA1B0C6728A3dbf268Dd7",
  cashToken:        "0xc83003B2AD5C3Ef3e93Cc3Ef0a48E84dc8DBD718",
  dvpSettlement:    "0xF216B6b2D9E76F94f97bE597e2Cec81730520585",
  tokenFactory:     "0x0F095aeA9540468B19829d02cC811Ebe5173D615",
  orderBookFactory: "0x36A8bE2C24f812ed7a95f14ffEBDB5F778F61699",
  orderBook:        "0x924eBd85044Ef7ef5DA5cA6A9939155aE8e709E0",
  timelock:         "0xe52155361a36C7d445F2c6784B14Bf7A3C306e15",
  governor:         "0x3b7f51aBe2E8e6Af03e1571dB791DDA7B5a68cE6",
};

// ---------------------------------------------------------------------------
// Role hashes
// ---------------------------------------------------------------------------
function roleHash(name) { return ethers.keccak256(ethers.toUtf8Bytes(name)); }

const ROLES = {
  DEFAULT_ADMIN_ROLE:    ethers.ZeroHash,                      // bytes32(0)
  AGENT_ROLE:            roleHash("AGENT_ROLE"),
  TIMELOCK_MINTER_ROLE:  roleHash("TIMELOCK_MINTER_ROLE"),
  OPERATOR_ROLE:         roleHash("OPERATOR_ROLE"),
  PAUSER_ROLE:           roleHash("PAUSER_ROLE"),
  COMPLIANCE_OFFICER_ROLE: roleHash("COMPLIANCE_OFFICER_ROLE"),
  MLRO_ROLE:             roleHash("MLRO_ROLE"),
  TOKEN_ROLE:            roleHash("TOKEN_ROLE"),
};

// ---------------------------------------------------------------------------
// Helper — grant / revoke / renounce with dry-run awareness
// ---------------------------------------------------------------------------
async function safeGrant(contract, name, role, roleName, target, targetLabel) {
  const has = await contract.hasRole(role, target);
  if (has) {
    console.log(`  [SKIP] ${name}: ${targetLabel} already has ${roleName}`);
    return;
  }
  if (DRY_RUN) {
    console.log(`  [DRY]  ${name}: Would grant ${roleName} to ${targetLabel}`);
    return;
  }
  const tx = await contract.grantRole(role, target);
  await tx.wait();
  console.log(`  [✓]    ${name}: Granted ${roleName} to ${targetLabel}`);
}

async function safeRenounce(contract, name, role, roleName, account, accountLabel) {
  const has = await contract.hasRole(role, account);
  if (!has) {
    console.log(`  [SKIP] ${name}: ${accountLabel} already renounced ${roleName}`);
    return;
  }
  if (DRY_RUN) {
    console.log(`  [DRY]  ${name}: Would renounce ${roleName} from ${accountLabel}`);
    return;
  }
  const tx = await contract.renounceRole(role, account);
  await tx.wait();
  console.log(`  [✓]    ${name}: ${accountLabel} renounced ${roleName}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Production Hardening: Transfer Admin Roles → Timelock      ║");
  if (DRY_RUN) {
    console.log("║                     *** DRY RUN MODE ***                     ║");
  }
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("Starting embedded block producer...\n");
  const blockProducer = startBlockProducer();

  const [deployer] = await ethers.getSigners();
  const TIMELOCK = CONTRACTS.timelock;

  console.log("Deployer : ", deployer.address);
  console.log("Timelock : ", TIMELOCK);
  console.log("Dry run  : ", DRY_RUN ? "YES (no transactions)" : "NO (LIVE!)");
  console.log();

  // ── Load contract instances ──────────────────────────────────────────
  const securityToken    = await ethers.getContractAt("HKSTPSecurityToken",    CONTRACTS.securityToken);
  const identityRegistry = await ethers.getContractAt("HKSTPIdentityRegistry", CONTRACTS.identityRegistry);
  const compliance       = await ethers.getContractAt("HKSTPCompliance",       CONTRACTS.compliance);
  const dvpSettlement    = await ethers.getContractAt("DvPSettlement",         CONTRACTS.dvpSettlement);
  const tokenFactory     = await ethers.getContractAt("TokenFactory",          CONTRACTS.tokenFactory);
  const orderBookFactory = await ethers.getContractAt("OrderBookFactory",      CONTRACTS.orderBookFactory);
  const orderBook        = await ethers.getContractAt("OrderBook",             CONTRACTS.orderBook);

  // All contracts that use AccessControl with DEFAULT_ADMIN_ROLE
  const allContracts = [
    { name: "SecurityToken",    contract: securityToken },
    { name: "IdentityRegistry", contract: identityRegistry },
    { name: "Compliance",       contract: compliance },
    { name: "DvPSettlement",    contract: dvpSettlement },
    { name: "TokenFactory",     contract: tokenFactory },
    { name: "OrderBookFactory", contract: orderBookFactory },
    { name: "OrderBook",        contract: orderBook },
  ];

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 0: Pre-flight check — verify deployer currently IS admin
  // ═══════════════════════════════════════════════════════════════════════
  console.log("════════════════════════════════════════════════════");
  console.log("  Step 0: Pre-flight — verify deployer is admin");
  console.log("════════════════════════════════════════════════════\n");

  let preFlight = true;
  for (const c of allContracts) {
    const has = await c.contract.hasRole(ROLES.DEFAULT_ADMIN_ROLE, deployer.address);
    const status = has ? "✓" : "✗";
    console.log(`  [${status}] ${c.name}`);
    if (!has) preFlight = false;
  }
  if (!preFlight) {
    console.error("\n❌ Deployer is NOT admin on all contracts. Cannot proceed.\n");
    await blockProducer.stop();
    process.exit(1);
  }
  console.log("\n  All pre-flight checks passed ✓\n");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 1: Grant DEFAULT_ADMIN_ROLE to Timelock on ALL contracts
  // ═══════════════════════════════════════════════════════════════════════
  console.log("════════════════════════════════════════════════════");
  console.log("  Step 1: Grant DEFAULT_ADMIN_ROLE → Timelock");
  console.log("════════════════════════════════════════════════════\n");

  for (const c of allContracts) {
    await safeGrant(
      c.contract, c.name,
      ROLES.DEFAULT_ADMIN_ROLE, "DEFAULT_ADMIN_ROLE",
      TIMELOCK, "Timelock"
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 2: Grant TIMELOCK_MINTER_ROLE to Timelock on SecurityToken
  //          (enables governance-approved large mints)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n════════════════════════════════════════════════════");
  console.log("  Step 2: Grant TIMELOCK_MINTER_ROLE → Timelock");
  console.log("          (SecurityToken only)");
  console.log("════════════════════════════════════════════════════\n");

  await safeGrant(
    securityToken, "SecurityToken",
    ROLES.TIMELOCK_MINTER_ROLE, "TIMELOCK_MINTER_ROLE",
    TIMELOCK, "Timelock"
  );

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 3: Grant operational roles to Timelock (so governance can
  //          perform operational actions if deployer AGENT_ROLE is later
  //          revoked via governance proposal)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n════════════════════════════════════════════════════");
  console.log("  Step 3: Grant operational roles → Timelock");
  console.log("════════════════════════════════════════════════════\n");

  // DvPSettlement: OPERATOR_ROLE + PAUSER_ROLE
  await safeGrant(dvpSettlement, "DvPSettlement", ROLES.OPERATOR_ROLE, "OPERATOR_ROLE", TIMELOCK, "Timelock");
  await safeGrant(dvpSettlement, "DvPSettlement", ROLES.PAUSER_ROLE,   "PAUSER_ROLE",   TIMELOCK, "Timelock");

  // IdentityRegistry: AGENT_ROLE + COMPLIANCE_OFFICER_ROLE + MLRO_ROLE
  await safeGrant(identityRegistry, "IdentityRegistry", ROLES.AGENT_ROLE,             "AGENT_ROLE",             TIMELOCK, "Timelock");
  await safeGrant(identityRegistry, "IdentityRegistry", ROLES.COMPLIANCE_OFFICER_ROLE, "COMPLIANCE_OFFICER_ROLE", TIMELOCK, "Timelock");
  await safeGrant(identityRegistry, "IdentityRegistry", ROLES.MLRO_ROLE,               "MLRO_ROLE",               TIMELOCK, "Timelock");

  // SecurityToken: AGENT_ROLE (so governance can burn/freeze if needed)
  await safeGrant(securityToken, "SecurityToken", ROLES.AGENT_ROLE, "AGENT_ROLE", TIMELOCK, "Timelock");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 4: Verification before renounce
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n════════════════════════════════════════════════════");
  console.log("  Step 4: Verify Timelock roles before renounce");
  console.log("════════════════════════════════════════════════════\n");

  let allGranted = true;
  for (const c of allContracts) {
    const has = await c.contract.hasRole(ROLES.DEFAULT_ADMIN_ROLE, TIMELOCK);
    const status = has ? "✓" : "✗";
    console.log(`  [${status}] ${c.name} → DEFAULT_ADMIN_ROLE`);
    if (!has) allGranted = false;
  }
  // Verify TIMELOCK_MINTER_ROLE
  const hasTLM = await securityToken.hasRole(ROLES.TIMELOCK_MINTER_ROLE, TIMELOCK);
  console.log(`  [${hasTLM ? "✓" : "✗"}] SecurityToken → TIMELOCK_MINTER_ROLE`);
  if (!hasTLM) allGranted = false;

  if (!allGranted && !DRY_RUN) {
    console.error("\n❌ Not all roles granted to Timelock. Aborting renounce.");
    await blockProducer.stop();
    process.exit(1);
  }
  console.log("\n  All Timelock roles verified ✓\n");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 5: Renounce deployer's DEFAULT_ADMIN_ROLE (IRREVERSIBLE!)
  //          Note: deployer KEEPS AGENT_ROLE for day-to-day operations
  //          (mint ≤ threshold, burn, freeze). Governance can revoke
  //          AGENT_ROLE later via a Timelock proposal if needed.
  // ═══════════════════════════════════════════════════════════════════════
  console.log("════════════════════════════════════════════════════");
  console.log("  Step 5: Renounce deployer DEFAULT_ADMIN_ROLE");
  console.log("          (IRREVERSIBLE!)");
  console.log("════════════════════════════════════════════════════\n");

  for (const c of allContracts) {
    await safeRenounce(
      c.contract, c.name,
      ROLES.DEFAULT_ADMIN_ROLE, "DEFAULT_ADMIN_ROLE",
      deployer.address, "Deployer"
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 6: Renounce deployer's OPERATOR_ROLE + PAUSER_ROLE on DvP
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n════════════════════════════════════════════════════");
  console.log("  Step 6: Renounce deployer operational roles");
  console.log("          (DvP: OPERATOR + PAUSER)");
  console.log("════════════════════════════════════════════════════\n");

  await safeRenounce(dvpSettlement, "DvPSettlement", ROLES.OPERATOR_ROLE, "OPERATOR_ROLE", deployer.address, "Deployer");
  await safeRenounce(dvpSettlement, "DvPSettlement", ROLES.PAUSER_ROLE,   "PAUSER_ROLE",   deployer.address, "Deployer");

  // ═══════════════════════════════════════════════════════════════════════
  //  STEP 7: Final comprehensive verification
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n════════════════════════════════════════════════════");
  console.log("  Step 7: Final role matrix");
  console.log("════════════════════════════════════════════════════\n");

  console.log("  Contract              Role                       Deployer  Timelock");
  console.log("  ──────────────────────────────────────────────────────────────────────");

  const checks = [
    // DEFAULT_ADMIN_ROLE on all
    ...allContracts.map(c => ({ name: c.name, contract: c.contract, role: ROLES.DEFAULT_ADMIN_ROLE, roleName: "DEFAULT_ADMIN_ROLE" })),
    // SecurityToken specific
    { name: "SecurityToken",    contract: securityToken,    role: ROLES.AGENT_ROLE,           roleName: "AGENT_ROLE" },
    { name: "SecurityToken",    contract: securityToken,    role: ROLES.TIMELOCK_MINTER_ROLE, roleName: "TIMELOCK_MINTER_ROLE" },
    // IdentityRegistry specific
    { name: "IdentityRegistry", contract: identityRegistry, role: ROLES.AGENT_ROLE,             roleName: "AGENT_ROLE" },
    { name: "IdentityRegistry", contract: identityRegistry, role: ROLES.COMPLIANCE_OFFICER_ROLE, roleName: "COMPLIANCE_OFFICER" },
    { name: "IdentityRegistry", contract: identityRegistry, role: ROLES.MLRO_ROLE,               roleName: "MLRO_ROLE" },
    // DvPSettlement specific
    { name: "DvPSettlement",    contract: dvpSettlement,    role: ROLES.OPERATOR_ROLE, roleName: "OPERATOR_ROLE" },
    { name: "DvPSettlement",    contract: dvpSettlement,    role: ROLES.PAUSER_ROLE,   roleName: "PAUSER_ROLE" },
  ];

  let issues = 0;
  for (const chk of checks) {
    const deployerHas = await chk.contract.hasRole(chk.role, deployer.address);
    const timelockHas = await chk.contract.hasRole(chk.role, TIMELOCK);

    const padName = chk.name.padEnd(20);
    const padRole = chk.roleName.padEnd(25);

    // Expected: deployer should NOT have DEFAULT_ADMIN_ROLE, OPERATOR_ROLE, PAUSER_ROLE
    // Expected: deployer MAY keep AGENT_ROLE on SecurityToken + IdentityRegistry
    const isAdminOrOp = [
      ROLES.DEFAULT_ADMIN_ROLE,
      ROLES.OPERATOR_ROLE,
      ROLES.PAUSER_ROLE,
    ].some(r => r === chk.role);

    const dIcon = deployerHas ? (isAdminOrOp ? "YES ⚠ " : "YES   ") : "NO  ✓ ";
    const tIcon = timelockHas ? "YES ✓" : "NO  ✗";

    console.log(`  ${padName}  ${padRole}  ${dIcon}    ${tIcon}`);

    // Flag unexpected states
    if (isAdminOrOp && deployerHas && !DRY_RUN) issues++;
    if (!timelockHas && chk.roleName !== "AGENT_ROLE" && chk.roleName !== "COMPLIANCE_OFFICER" && chk.roleName !== "MLRO_ROLE" && !DRY_RUN) issues++;
  }

  await blockProducer.stop();

  // ── Summary ──────────────────────────────────────────────────────────
  console.log();
  if (DRY_RUN) {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  DRY RUN COMPLETE — no transactions were sent.              ║");
    console.log("║                                                             ║");
    console.log("║  To execute for real, run WITHOUT DRY_RUN=1:                ║");
    console.log("║    npx hardhat run scripts/harden-admin.js --network besu   ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
  } else if (issues > 0) {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log(`║  ⚠ Hardening completed with ${issues} issue(s).                    ║`);
    console.log("║  Review the role matrix above for unexpected states.        ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
  } else {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║  ✅ Admin hardening complete!                               ║");
    console.log("║                                                             ║");
    console.log("║  Timelock now controls:                                     ║");
    console.log("║    • DEFAULT_ADMIN_ROLE on all 7 contracts                  ║");
    console.log("║    • TIMELOCK_MINTER_ROLE on SecurityToken (large mints)    ║");
    console.log("║    • OPERATOR + PAUSER on DvPSettlement                     ║");
    console.log("║    • AGENT + CO + MLRO on IdentityRegistry                  ║");
    console.log("║                                                             ║");
    console.log("║  Deployer retains AGENT_ROLE for day-to-day operations:     ║");
    console.log("║    • Mint ≤ threshold, burn, freeze, safe-list              ║");
    console.log("║    • KYC registration on IdentityRegistry                   ║");
    console.log("║                                                             ║");
    console.log("║  To fully remove deployer AGENT_ROLE later, submit a        ║");
    console.log("║  governance proposal via the Timelock.                      ║");
    console.log("║                                                             ║");
    console.log("║  All admin changes require: Proposal → Vote → 48h delay.   ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
