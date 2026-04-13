/**
 * @title deploy-and-update-frontend.js
 * @notice Deploys all contracts (Hardhat Network or Besu), then auto-updates
 *         frontend/src/config/contracts.ts with the real addresses.
 *
 * Works with both:
 *   - Hardhat Network (auto-mine, no block producer needed)
 *   - Besu + Engine API (embedded block producer starts automatically)
 *
 * Usage:
 *   npx hardhat run scripts/deploy-and-update-frontend.js --network localhost
 *   npx hardhat run scripts/deploy-and-update-frontend.js --network besu
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Embedded Engine-API block producer (only used with Besu)
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

/** Detect whether Besu Engine API is available */
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

// No-op block producer for Hardhat Network (auto-mines)
function noopBlockProducer() {
  return { stop: async () => {} };
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------
async function main() {
  // Start embedded block producer only if Besu Engine API is available
  const useEngine = await hasEngineAPI();
  let blockProducer;
  if (useEngine) {
    console.log("Mode: Besu + Engine API (block producer started)\n");
    blockProducer = startBlockProducer();
  } else {
    console.log("Mode: Hardhat Network (auto-mine)\n");
    blockProducer = noopBlockProducer();
  }

  const signers = await ethers.getSigners();
  const deployer  = signers[0];
  const operator  = signers.length > 1 ? signers[1] : deployer;
  const agent     = signers.length > 2 ? signers[2] : deployer;  // agent / custodian
  const seller    = signers.length > 3 ? signers[3] : deployer;
  const buyer     = signers.length > 4 ? signers[4] : deployer;

  console.log("Deploying with account:", deployer.address);
  console.log("Operator :", operator.address);
  console.log("Agent    :", agent.address);
  console.log("Seller   :", seller.address);
  console.log("Buyer    :", buyer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH\n"
  );

  const complianceOracle =
    process.env.COMPLIANCE_ORACLE || deployer.address;
  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  const escrowAddress = process.env.ESCROW_ADDRESS || deployer.address;
  const custodianAddress = agent.address;

  // 1. IdentityRegistry
  console.log("1/12  Deploying HKSTPIdentityRegistry...");
  const IdentityRegistry = await ethers.getContractFactory(
    "HKSTPIdentityRegistry"
  );
  const registry = await IdentityRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("     HKSTPIdentityRegistry:", registryAddress);

  // 2. Compliance
  console.log("2/12  Deploying HKSTPCompliance...");
  const Compliance = await ethers.getContractFactory("HKSTPCompliance");
  const compliance = await Compliance.deploy(deployer.address, complianceOracle);
  await compliance.waitForDeployment();
  const complianceAddress = await compliance.getAddress();
  console.log("     HKSTPCompliance:", complianceAddress);

  // 3. SecurityToken
  console.log("3/12  Deploying HKSTPSecurityToken...");
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
  console.log("4/12  Deploying MockCashToken (tokenized HKD)...");
  const MockCash = await ethers.getContractFactory("MockCashToken");
  const cashToken = await MockCash.deploy("Tokenized HKD", "THKD", 6, deployer.address);
  await cashToken.waitForDeployment();
  const cashTokenAddress = await cashToken.getAddress();
  console.log("     MockCashToken (THKD):", cashTokenAddress);

  // 5. DvPSettlement
  console.log("5/12  Deploying DvPSettlement...");
  const DvP = await ethers.getContractFactory("DvPSettlement");
  const dvp = await DvP.deploy(deployer.address);
  await dvp.waitForDeployment();
  const dvpAddress = await dvp.getAddress();
  console.log("     DvPSettlement:", dvpAddress);

  // 6. TokenFactory
  console.log("6/12  Deploying TokenFactory...");
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
  console.log("7/12  Deploying ClaimIssuer...");
  const ClaimIssuerFactory = await ethers.getContractFactory("ClaimIssuer");
  const claimIssuer = await ClaimIssuerFactory.deploy(deployer.address, deployer.address);
  await claimIssuer.waitForDeployment();
  const claimIssuerAddress = await claimIssuer.getAddress();
  console.log("     ClaimIssuer:", claimIssuerAddress);

  // 8. IdentityFactory (deploys per-investor ONCHAINID contracts)
  console.log("8/12  Deploying IdentityFactory...");
  const IdentityFactoryContract = await ethers.getContractFactory("IdentityFactory");
  const identityFactory = await IdentityFactoryContract.deploy(deployer.address);
  await identityFactory.waitForDeployment();
  const identityFactoryAddress = await identityFactory.getAddress();
  console.log("     IdentityFactory:", identityFactoryAddress);

  // 9. Timelock (governance execution delay)
  console.log("9/12  Deploying HKSTPTimelock...");
  const TIMELOCK_MIN_DELAY = 172800; // 48 hours (production)
  const Timelock = await ethers.getContractFactory("HKSTPTimelock");
  const timelock = await Timelock.deploy(
    TIMELOCK_MIN_DELAY,
    [],                  // proposers — will grant to governor
    [],                  // executors — will grant to governor
    deployer.address     // bootstrap admin
  );
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log("     HKSTPTimelock:", timelockAddress);

  // 10. Governor (on-chain governance with snapshot voting)
  console.log("10/12 Deploying HKSTPGovernor...");
  const VOTING_DELAY  = 14400;  // ~2 days at 12s/block
  const VOTING_PERIOD = 50400;  // ~7 days at 12s/block
  const QUORUM_PCT    = 10;     // 10% of total supply
  // Proposal threshold = 1% of anticipated total supply (e.g. 1 000 000 tokens → 10 000)
  const PROPOSAL_THRESHOLD = ethers.parseEther("10000"); // 1% of 1M supply
  const Governor = await ethers.getContractFactory("HKSTPGovernor");
  const governor = await Governor.deploy(
    tokenAddress,        // IVotes token
    timelockAddress,     // TimelockController
    registryAddress,     // identityRegistry (KYC gate)
    VOTING_DELAY,
    VOTING_PERIOD,
    PROPOSAL_THRESHOLD,
    QUORUM_PCT
  );
  await governor.waitForDeployment();
  const governorAddress = await governor.getAddress();
  console.log("     HKSTPGovernor:", governorAddress);

  // 11. WalletRegistry (98/2 custody rule enforcement)
  console.log("11/12 Deploying WalletRegistry...");
  const WalletRegistry = await ethers.getContractFactory("WalletRegistry");
  const walletRegistry = await WalletRegistry.deploy(deployer.address);
  await walletRegistry.waitForDeployment();
  const walletRegistryAddress = await walletRegistry.getAddress();
  console.log("     WalletRegistry:", walletRegistryAddress);

  // 12. MultiSigWarm (2-of-3 multi-sig for warm wallet)
  console.log("12/12 Deploying MultiSigWarm...");
  // Use deployer + first two deterministic Besu accounts as initial signers
  // In production, replace with actual custody officer keys
  const warmSigner1 = deployer.address;
  const warmSigner2 = process.env.WARM_SIGNER_2 || "0x627306090abaB3A6e1400e9345bC60c78a8BEf57";
  const warmSigner3 = process.env.WARM_SIGNER_3 || "0xf17f52151EbEF6C7334FAD080c5704D77216b732";
  const MultiSigWarm = await ethers.getContractFactory("MultiSigWarm");
  const multiSigWarm = await MultiSigWarm.deploy([warmSigner1, warmSigner2, warmSigner3]);
  await multiSigWarm.waitForDeployment();
  const multiSigWarmAddress = await multiSigWarm.getAddress();
  console.log("     MultiSigWarm:", multiSigWarmAddress);

  // Post-deployment configuration
  console.log("\nConfiguring roles and safe-list...");
  const TOKEN_ROLE = await compliance.TOKEN_ROLE();
  await (await compliance.grantRole(TOKEN_ROLE, tokenAddress)).wait();
  console.log("     TOKEN_ROLE granted to SecurityToken on Compliance");

  // TokenFactory needs DEFAULT_ADMIN_ROLE on Compliance so it can call
  // compliance.grantRole(TOKEN_ROLE, newClone) inside createToken()
  const COMPLIANCE_ADMIN_ROLE = await compliance.DEFAULT_ADMIN_ROLE();
  await (await compliance.grantRole(COMPLIANCE_ADMIN_ROLE, tokenFactoryAddress)).wait();
  console.log("     DEFAULT_ADMIN_ROLE granted to TokenFactory on Compliance");

  // Grant OPERATOR_ROLE on DvP to the operator account
  const OPERATOR_ROLE = await dvp.OPERATOR_ROLE();
  await (await dvp.grantRole(OPERATOR_ROLE, operator.address)).wait();
  console.log("     OPERATOR_ROLE granted to operator on DvPSettlement:", operator.address);

  // Grant AGENT_ROLE on BOTH IdentityRegistry and SecurityToken to the agent/custodian
  const AGENT_ROLE_TOKEN    = await token.AGENT_ROLE();
  const AGENT_ROLE_REGISTRY = await registry.AGENT_ROLE();
  await (await token.grantRole(AGENT_ROLE_TOKEN, agent.address)).wait();
  console.log("     AGENT_ROLE granted to agent on HKSTPSecurityToken:", agent.address);
  await (await registry.grantRole(AGENT_ROLE_REGISTRY, agent.address)).wait();
  console.log("     AGENT_ROLE granted to agent on HKSTPIdentityRegistry:", agent.address);

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

  // Cap. 622: Set 50-shareholder limit on the security token
  console.log("\nConfiguring Cap. 622 shareholder cap...");
  await (await token.setMaxShareholders(50)).wait();
  console.log("     maxShareholders set to 50 on HKSTPSecurityToken");

  // Governance: wire Timelock roles → Governor
  console.log("\nConfiguring Governance (Timelock + Governor)...");
  const PROPOSER_ROLE  = await timelock.PROPOSER_ROLE();
  const EXECUTOR_ROLE  = await timelock.EXECUTOR_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  await (await timelock.grantRole(PROPOSER_ROLE, governorAddress)).wait();
  console.log("     PROPOSER_ROLE granted to Governor on Timelock");
  await (await timelock.grantRole(EXECUTOR_ROLE, governorAddress)).wait();
  console.log("     EXECUTOR_ROLE granted to Governor on Timelock");
  await (await timelock.grantRole(CANCELLER_ROLE, governorAddress)).wait();
  console.log("     CANCELLER_ROLE granted to Governor on Timelock");

  // Grant DEFAULT_ADMIN_ROLE on the SecurityToken to the Timelock
  // so governance proposals can call admin-only functions (e.g. pause, setCompliance)
  const TOKEN_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
  await (await token.grantRole(TOKEN_ADMIN_ROLE, timelockAddress)).wait();
  console.log("     DEFAULT_ADMIN_ROLE granted to Timelock on SecurityToken");

  // Custody: WalletRegistry + MultiSigWarm wiring
  console.log("\nConfiguring Custody (WalletRegistry + MultiSigWarm)...");

  // Track security token + cash token on WalletRegistry
  await (await walletRegistry.addTrackedToken(tokenAddress)).wait();
  console.log("     Tracked SecurityToken on WalletRegistry");
  await (await walletRegistry.addTrackedToken(cashTokenAddress)).wait();
  console.log("     Tracked CashToken on WalletRegistry");

  // Register the multi-sig as a WARM wallet
  await (await walletRegistry.registerWallet(multiSigWarmAddress, 2, "Warm-MultiSig")).wait();
  console.log("     MultiSigWarm registered as WARM wallet");

  // Register deployer as a placeholder HOT wallet (replace in production)
  await (await walletRegistry.registerWallet(deployer.address, 1, "Hot-Deployer")).wait();
  console.log("     Deployer registered as HOT wallet (placeholder)");

  // Safe-list the WalletRegistry and MultiSigWarm on the security token
  await (await token.setSafeList(walletRegistryAddress, true)).wait();
  console.log("     WalletRegistry safe-listed on SecurityToken");
  await (await token.setSafeList(multiSigWarmAddress, true)).wait();
  console.log("     MultiSigWarm safe-listed on SecurityToken");

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
  timelock: '${timelockAddress}',
  governor: '${governorAddress}',
  walletRegistry: '${walletRegistryAddress}',
  multiSigWarm: '${multiSigWarmAddress}',
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
    `║ HKSTPTimelock         : ${timelockAddress}  ║`
  );
  console.log(
    `║ HKSTPGovernor         : ${governorAddress}  ║`
  );
  console.log(
    `║ WalletRegistry        : ${walletRegistryAddress}  ║`
  );
  console.log(
    `║ MultiSigWarm          : ${multiSigWarmAddress}  ║`
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════╣"
  );
  console.log(
    `║ Compliance Oracle     : ${complianceOracle}  ║`
  );
  console.log(
    `║ Cap. 622 Shareholder Cap : 50 (identity-based)                ║`
  );
  console.log(
    `║ Governance: delay=${VOTING_DELAY}blk period=${VOTING_PERIOD}blk quorum=${QUORUM_PCT}%   ║`
  );
  console.log(
    `║ Proposal threshold: ${ethers.formatEther(PROPOSAL_THRESHOLD)} tokens (1%)              ║`
  );
  console.log(
    `║ Timelock delay: ${TIMELOCK_MIN_DELAY}s (48h) | Identity-locked voting  ║`
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
