/**
 * @title deploy-and-update-frontend.js
 * @notice Deploys all contracts to Besu, then auto-updates
 *         frontend/src/config/contracts.ts with the real addresses.
 *
 * Includes an embedded block producer so the script is self-contained —
 * no need to run a separate block-producer.js process.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-and-update-frontend.js --network besu
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Embedded Engine-API block producer (runs in background during deployment)
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
  if (np.status !== "VALID") {
    console.error("  ⚠  newPayload status:", np.status, np.validationError || "");
    return null;
  }

  await engineRpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    { headBlockHash: ep.blockHash, safeBlockHash: ep.blockHash, finalizedBlockHash: ep.blockHash },
    null,
  ]);
  return { number: parseInt(ep.blockNumber, 16), txCount: (ep.transactions || []).length };
}

/** Background block-producer loop — resolves stopFn to halt it */
function startBlockProducer() {
  let running = true;
  const promise = (async () => {
    while (running) {
      try {
        const pending = await engineRpc(ETH_URL, "txpool_besuStatistics", [])
          .then((r) => (r.localCount || 0) + (r.remoteCount || 0))
          .catch(() => 0);

        const latest = await engineRpc(ETH_URL, "eth_getBlockByNumber", ["latest", false]);
        const currentBlock = parseInt(latest.number, 16);

        if (pending > 0 || currentBlock === 0) {
          const blk = await produceOneBlock();
          if (blk) console.log(`  ⛏  Block #${blk.number}  txs=${blk.txCount}`);
        }
      } catch (err) {
        // swallow — let deploy continue
      }
      await new Promise((r) => setTimeout(r, 400)); // fast poll during deploy
    }
  })();
  return { stop: () => { running = false; return promise; } };
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------
async function main() {
  // Start embedded block producer so transactions get mined
  console.log("Starting embedded block producer...\n");
  const blockProducer = startBlockProducer();

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH\n"
  );

  const complianceOracle =
    process.env.COMPLIANCE_ORACLE || deployer.address;
  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  const escrowAddress = process.env.ESCROW_ADDRESS || deployer.address;
  const custodianAddress = process.env.CUSTODIAN_ADDRESS || deployer.address;

  // 1. IdentityRegistry
  console.log("1/8  Deploying HKSTPIdentityRegistry...");
  const IdentityRegistry = await ethers.getContractFactory(
    "HKSTPIdentityRegistry"
  );
  const registry = await IdentityRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("     HKSTPIdentityRegistry:", registryAddress);

  // 2. Compliance
  console.log("2/8  Deploying HKSTPCompliance...");
  const Compliance = await ethers.getContractFactory("HKSTPCompliance");
  const compliance = await Compliance.deploy(deployer.address, complianceOracle);
  await compliance.waitForDeployment();
  const complianceAddress = await compliance.getAddress();
  console.log("     HKSTPCompliance:", complianceAddress);

  // 3. SecurityToken
  console.log("3/8  Deploying HKSTPSecurityToken...");
  const Token = await ethers.getContractFactory("HKSTPSecurityToken");
  const token = await Token.deploy(
    "HKSTP Alpha Startup Token",
    "HKSAT",
    registryAddress,
    complianceAddress,
    ethers.ZeroAddress,
    deployer.address
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("     HKSTPSecurityToken:", tokenAddress);

  // 4. MockCashToken
  console.log("4/8  Deploying MockCashToken (tokenized HKD)...");
  const MockCash = await ethers.getContractFactory("MockCashToken");
  const cashToken = await MockCash.deploy("Tokenized HKD", "THKD", 6, deployer.address);
  await cashToken.waitForDeployment();
  const cashTokenAddress = await cashToken.getAddress();
  console.log("     MockCashToken (THKD):", cashTokenAddress);

  // 5. DvPSettlement
  console.log("5/8  Deploying DvPSettlement...");
  const DvP = await ethers.getContractFactory("DvPSettlement");
  const dvp = await DvP.deploy(deployer.address);
  await dvp.waitForDeployment();
  const dvpAddress = await dvp.getAddress();
  console.log("     DvPSettlement:", dvpAddress);

  // 6. TokenFactory
  console.log("6/8  Deploying TokenFactory...");
  const TokenFactory = await ethers.getContractFactory("TokenFactory");
  const tokenFactory = await TokenFactory.deploy(
    deployer.address,    // admin
    registryAddress,     // identityRegistry
    complianceAddress    // compliance
  );
  await tokenFactory.waitForDeployment();
  const tokenFactoryAddress = await tokenFactory.getAddress();
  console.log("     TokenFactory:", tokenFactoryAddress);

  // 7. ClaimIssuer (Trusted Claim Issuer for ONCHAINID)
  console.log("7/8  Deploying ClaimIssuer...");
  const ClaimIssuerFactory = await ethers.getContractFactory("ClaimIssuer");
  const claimIssuer = await ClaimIssuerFactory.deploy(deployer.address, deployer.address);
  await claimIssuer.waitForDeployment();
  const claimIssuerAddress = await claimIssuer.getAddress();
  console.log("     ClaimIssuer:", claimIssuerAddress);

  // 8. IdentityFactory (deploys per-investor ONCHAINID contracts)
  console.log("8/8  Deploying IdentityFactory...");
  const IdentityFactoryContract = await ethers.getContractFactory("IdentityFactory");
  const identityFactory = await IdentityFactoryContract.deploy(deployer.address);
  await identityFactory.waitForDeployment();
  const identityFactoryAddress = await identityFactory.getAddress();
  console.log("     IdentityFactory:", identityFactoryAddress);

  // Post-deployment configuration
  console.log("\nConfiguring roles and safe-list...");
  const TOKEN_ROLE = await compliance.TOKEN_ROLE();
  await (await compliance.grantRole(TOKEN_ROLE, tokenAddress)).wait();
  console.log("     TOKEN_ROLE granted to SecurityToken on Compliance");

  const OPERATOR_ROLE = await dvp.OPERATOR_ROLE();
  await (await dvp.grantRole(OPERATOR_ROLE, deployer.address)).wait();
  console.log("     OPERATOR_ROLE granted to deployer on DvPSettlement");

  const AGENT_ROLE = await token.AGENT_ROLE();
  if (custodianAddress !== deployer.address) {
    await (await token.grantRole(AGENT_ROLE, custodianAddress)).wait();
    console.log("     AGENT_ROLE granted to custodian:", custodianAddress);
  }

  for (const op of [
    { name: "Treasury", addr: treasuryAddress },
    { name: "Escrow", addr: escrowAddress },
  ]) {
    if (op.addr !== deployer.address) {
      await (await token.setSafeList(op.addr, true)).wait();
      console.log(`     Safe-listed ${op.name}: ${op.addr}`);
    }
  }

  // ONCHAINID wiring: IdentityFactory + ClaimIssuer → IdentityRegistry
  console.log("\nConfiguring ONCHAINID identity system...");

  // Set IdentityFactory on the registry
  await (await registry.setIdentityFactory(identityFactoryAddress)).wait();
  console.log("     IdentityFactory set on IdentityRegistry");

  // Grant DEPLOYER_ROLE on IdentityFactory to the IdentityRegistry
  const DEPLOYER_ROLE = await identityFactory.DEPLOYER_ROLE();
  await (await identityFactory.grantRole(DEPLOYER_ROLE, registryAddress)).wait();
  console.log("     DEPLOYER_ROLE granted to IdentityRegistry on IdentityFactory");

  // Add ClaimIssuer as a Trusted Issuer for all 5 claim topics
  await (await registry.addTrustedIssuer(claimIssuerAddress, [1, 2, 3, 4, 5])).wait();
  console.log("     ClaimIssuer added as Trusted Issuer for topics 1-5");

  // -----------------------------------------------------------------------
  // AUTO-UPDATE frontend/src/config/contracts.ts
  // -----------------------------------------------------------------------
  const contractsFile = path.join(
    __dirname,
    "..",
    "frontend",
    "src",
    "config",
    "contracts.ts"
  );

  if (fs.existsSync(contractsFile)) {
    console.log("\nUpdating frontend contract addresses...");
    let content = fs.readFileSync(contractsFile, "utf-8");

    // Replace the CONTRACT_ADDRESSES block
    const oldBlock =
      /export const CONTRACT_ADDRESSES\s*=\s*\{[^}]+\};/;
    const newBlock = `export const CONTRACT_ADDRESSES = {
  identityRegistry: '${registryAddress}',
  compliance: '${complianceAddress}',
  securityToken: '${tokenAddress}',
  cashToken: '${cashTokenAddress}',
  dvpSettlement: '${dvpAddress}',
  tokenFactory: '${tokenFactoryAddress}',
  claimIssuer: '${claimIssuerAddress}',
  identityFactory: '${identityFactoryAddress}',
};`;

    if (oldBlock.test(content)) {
      content = content.replace(oldBlock, newBlock);
      fs.writeFileSync(contractsFile, content, "utf-8");
      console.log("     ✓ frontend/src/config/contracts.ts updated");
    } else {
      console.log(
        "     ⚠ Could not find CONTRACT_ADDRESSES block — update manually"
      );
    }
  } else {
    console.log(
      "\n⚠ frontend/src/config/contracts.ts not found — skipping auto-update"
    );
  }

  // Stop embedded block producer
  await blockProducer.stop();
  console.log("\nEmbedded block producer stopped.");

  // Summary
  console.log(
    "\n╔══════════════════════════════════════════════════════════════╗"
  );
  console.log(
    "║               TokenHub Deployment Summary                   ║"
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════╣"
  );
  console.log(
    `║ HKSTPIdentityRegistry : ${registryAddress}  ║`
  );
  console.log(
    `║ HKSTPCompliance       : ${complianceAddress}  ║`
  );
  console.log(
    `║ HKSTPSecurityToken    : ${tokenAddress}  ║`
  );
  console.log(
    `║ MockCashToken (THKD)  : ${cashTokenAddress}  ║`
  );
  console.log(
    `║ DvPSettlement         : ${dvpAddress}  ║`
  );
  console.log(
    `║ TokenFactory          : ${tokenFactoryAddress}  ║`
  );
  console.log(
    `║ ClaimIssuer           : ${claimIssuerAddress}  ║`
  );
  console.log(
    `║ IdentityFactory       : ${identityFactoryAddress}  ║`
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════╣"
  );
  console.log(
    `║ Compliance Oracle     : ${complianceOracle}  ║`
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝"
  );
  console.log(
    "\n🚀 Frontend is ready: cd frontend && npm run dev"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
