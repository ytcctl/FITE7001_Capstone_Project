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

  // Auto-fund dev accounts when deploying to external Anvil (accounts start with 0 ETH)
  const deployerBal = await ethers.provider.getBalance(deployer.address);
  if (deployerBal === 0n) {
    console.log("Funding dev accounts from Anvil default account...");
    const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    const funder = new ethers.Wallet(ANVIL_KEY, ethers.provider);
    const devAddrs = [deployer, operator, agent, seller, buyer].map(s => s.address);
    // Also fund the known investor test address
    devAddrs.push("0xe8564b67f8a638971ab2A519e786f9ce1182c86f");
    let nonce = await ethers.provider.getTransactionCount(funder.address);
    for (const addr of devAddrs) {
      const tx = await funder.sendTransaction({ to: addr, value: ethers.parseEther("1000"), nonce });
      await tx.wait();
      nonce++;
    }
    console.log(`     Funded ${devAddrs.length} accounts with 1000 ETH each\n`);
  }

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
  console.log("1/17  Deploying HKSTPIdentityRegistry...");
  const IdentityRegistry = await ethers.getContractFactory(
    "HKSTPIdentityRegistry"
  );
  const registry = await IdentityRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("     HKSTPIdentityRegistry:", registryAddress);

  // 2. Compliance
  console.log("2/17  Deploying HKSTPCompliance...");
  const Compliance = await ethers.getContractFactory("HKSTPCompliance");
  const compliance = await Compliance.deploy(deployer.address, complianceOracle);
  await compliance.waitForDeployment();
  const complianceAddress = await compliance.getAddress();
  console.log("     HKSTPCompliance:", complianceAddress);

  // XX neutral jurisdiction is set in the constructor, but verify it here
  // (safe-listed addresses use "XX" so they pass jurisdiction checks)
  const xxSet = await compliance.allowedJurisdictions(ethers.encodeBytes32String("XX").slice(0, 6));
  if (!xxSet) {
    await (await compliance.setJurisdiction(ethers.encodeBytes32String("XX").slice(0, 6), true)).wait();
    console.log("     XX neutral jurisdiction added");
  }

  // 3. SecurityToken
  console.log("3/17  Deploying HKSTPSecurityToken...");
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
  console.log("4/17  Deploying MockCashToken (tokenized HKD)...");
  const MockCash = await ethers.getContractFactory("MockCashToken");
  const cashToken = await MockCash.deploy("Tokenized HKD", "THKD", 6, deployer.address);
  await cashToken.waitForDeployment();
  const cashTokenAddress = await cashToken.getAddress();
  console.log("     MockCashToken (THKD):", cashTokenAddress);

  // 5. DvPSettlement
  console.log("5/17  Deploying DvPSettlement...");
  const DvP = await ethers.getContractFactory("DvPSettlement");
  const dvp = await DvP.deploy(deployer.address);
  await dvp.waitForDeployment();
  const dvpAddress = await dvp.getAddress();
  console.log("     DvPSettlement:", dvpAddress);

  // 6. TokenFactory
  console.log("6/17  Deploying TokenFactory...");
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
  console.log("7/17  Deploying ClaimIssuer...");
  const ClaimIssuerFactory = await ethers.getContractFactory("ClaimIssuer");
  const claimIssuer = await ClaimIssuerFactory.deploy(deployer.address, deployer.address);
  await claimIssuer.waitForDeployment();
  const claimIssuerAddress = await claimIssuer.getAddress();
  console.log("     ClaimIssuer:", claimIssuerAddress);

  // 8. IdentityFactory (deploys per-investor ONCHAINID contracts)
  console.log("8/17  Deploying IdentityFactory...");
  const IdentityFactoryContract = await ethers.getContractFactory("IdentityFactory");
  const identityFactory = await IdentityFactoryContract.deploy(deployer.address);
  await identityFactory.waitForDeployment();
  const identityFactoryAddress = await identityFactory.getAddress();
  console.log("     IdentityFactory:", identityFactoryAddress);

  // 9. Timelock (governance execution delay)
  console.log("9/17  Deploying HKSTPTimelock...");
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
  console.log("10/17 Deploying HKSTPGovernor...");
  const VOTING_DELAY  = 172800; // 48 hours in seconds (timestamp-based clock)
  const VOTING_PERIOD = 604800; // 7 days in seconds  (timestamp-based clock)
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
  console.log("11/17 Deploying WalletRegistry...");
  const WalletRegistry = await ethers.getContractFactory("WalletRegistry");
  const walletRegistry = await WalletRegistry.deploy(deployer.address);
  await walletRegistry.waitForDeployment();
  const walletRegistryAddress = await walletRegistry.getAddress();
  console.log("     WalletRegistry:", walletRegistryAddress);

  // 12. MultiSigWarm (configurable multi-sig for warm wallet)
  console.log("12/17 Deploying MultiSigWarm...");
  // Use deployer + first two deterministic Besu accounts as initial signers
  // In production, replace with actual custody officer keys
  const warmSigner1 = deployer.address;
  const warmSigner2 = process.env.WARM_SIGNER_2 || "0x627306090abaB3A6e1400e9345bC60c78a8BEf57";
  const warmSigner3 = process.env.WARM_SIGNER_3 || "0xf17f52151EbEF6C7334FAD080c5704D77216b732";
  const warmSigners = [warmSigner1, warmSigner2, warmSigner3];
  const warmThreshold = parseInt(process.env.WARM_THRESHOLD || "2", 10);
  const MultiSigWarm = await ethers.getContractFactory("MultiSigWarm");
  const multiSigWarm = await MultiSigWarm.deploy(warmSigners, warmThreshold);
  await multiSigWarm.waitForDeployment();
  const multiSigWarmAddress = await multiSigWarm.getAddress();
  console.log("     MultiSigWarm:", multiSigWarmAddress, `(${warmThreshold}-of-${warmSigners.length})`);

  // 13. OracleCommittee (multi-oracle threshold attestation)
  console.log("13/17 Deploying OracleCommittee...");
  // Use deployer + operator + agent as initial oracle members (2-of-3 threshold)
  const oracleMembers = [deployer.address, operator.address, agent.address];
  const OracleCommittee = await ethers.getContractFactory("OracleCommittee");
  const oracleCommittee = await OracleCommittee.deploy(
    deployer.address,    // admin
    oracleMembers,       // initial oracle members
    2                    // threshold (2-of-3)
  );
  await oracleCommittee.waitForDeployment();
  const oracleCommitteeAddress = await oracleCommittee.getAddress();
  console.log("     OracleCommittee:", oracleCommitteeAddress);

  // 14. OrderBookFactory (deploys per-token OrderBooks)
  console.log("14/17 Deploying OrderBookFactory...");
  const OBFactory = await ethers.getContractFactory("OrderBookFactory");
  const orderBookFactory = await OBFactory.deploy(
    cashTokenAddress,    // shared cash token (THKD)
    6,                   // cash token decimals
    registryAddress,     // identityRegistry (KYC gate)
    deployer.address     // admin
  );
  await orderBookFactory.waitForDeployment();
  const orderBookFactoryAddress = await orderBookFactory.getAddress();
  console.log("     OrderBookFactory:", orderBookFactoryAddress);

  // 15. OrderBook (standalone on-chain order book for HKSAT/THKD)
  console.log("15/17 Deploying OrderBook...");
  const OrderBookContract = await ethers.getContractFactory("OrderBook");
  const orderBook = await OrderBookContract.deploy(
    tokenAddress,        // securityToken
    cashTokenAddress,    // cashToken
    18,                  // HKSTPSecurityToken decimals
    6,                   // MockCashToken (THKD) decimals
    registryAddress,     // identityRegistry (KYC gate)
    deployer.address     // admin
  );
  await orderBook.waitForDeployment();
  const orderBookAddress = await orderBook.getAddress();
  console.log("     OrderBook:", orderBookAddress);

  // 16. TokenFactoryV2 (upgradeable proxy token factory)
  console.log("16/17 Deploying TokenFactoryV2...");
  const TokenFactoryV2 = await ethers.getContractFactory("TokenFactoryV2");
  const tokenFactoryV2 = await TokenFactoryV2.deploy(
    deployer.address,    // admin
    registryAddress,     // identityRegistry
    complianceAddress,   // compliance
    tokenAddress         // implementation (use deployed SecurityToken as reference impl)
  );
  await tokenFactoryV2.waitForDeployment();
  const tokenFactoryV2Address = await tokenFactoryV2.getAddress();
  console.log("     TokenFactoryV2:", tokenFactoryV2Address);

  // 17. SystemHealthCheck (optional — deploy if contract exists)
  let systemHealthCheckAddress = ethers.ZeroAddress;
  try {
    console.log("17/17 Deploying SystemHealthCheck...");
    const SHC = await ethers.getContractFactory("SystemHealthCheck");
    const shc = await SHC.deploy();
    await shc.waitForDeployment();
    systemHealthCheckAddress = await shc.getAddress();
    console.log("     SystemHealthCheck:", systemHealthCheckAddress);
  } catch (e) {
    console.log("     ⚠ SystemHealthCheck skipped (contract not found or error)");
  }

  // 18/18. GovernorFactory (per-token governance registry)
  console.log("18/18 Deploying GovernorFactory...");
  const GovernorFactory = await ethers.getContractFactory("GovernorFactory");
  const governorFactory = await GovernorFactory.deploy(deployer.address);
  await governorFactory.waitForDeployment();
  const governorFactoryAddress = await governorFactory.getAddress();
  console.log("     GovernorFactory:", governorFactoryAddress);

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

  // Grant OPERATOR_ROLE on DvP to operator + both investor accounts
  const OPERATOR_ROLE = await dvp.OPERATOR_ROLE();
  await (await dvp.grantRole(OPERATOR_ROLE, operator.address)).wait();
  console.log("     OPERATOR_ROLE granted to operator on DvPSettlement:", operator.address);
  await (await dvp.grantRole(OPERATOR_ROLE, seller.address)).wait();
  console.log("     OPERATOR_ROLE granted to seller on DvPSettlement:", seller.address);
  await (await dvp.grantRole(OPERATOR_ROLE, buyer.address)).wait();
  console.log("     OPERATOR_ROLE granted to buyer on DvPSettlement:", buyer.address);

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

  // GovernorFactory: register the initial securityToken's governance
  console.log("\nRegistering initial token governance via GovernorFactory...");
  await (await governorFactory.registerGovernance(tokenAddress, governorAddress, timelockAddress)).wait();
  console.log("     Registered HKSAT governance (governor:", governorAddress, "timelock:", timelockAddress, ")");

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

  // Grant OPERATOR_ROLE on WalletRegistry to all multi-sig signers so any signer
  // can auto-record sweeps after executeTx() without a separate admin step
  const WR_OPERATOR_ROLE = await walletRegistry.OPERATOR_ROLE();
  await (await walletRegistry.grantRole(WR_OPERATOR_ROLE, operator.address)).wait();
  await (await walletRegistry.grantRole(WR_OPERATOR_ROLE, agent.address)).wait();
  console.log("     OPERATOR_ROLE granted to Operator + Agent on WalletRegistry");

  // Register deployer as a placeholder HOT wallet (replace in production)
  await (await walletRegistry.registerWallet(deployer.address, 1, "Hot-Deployer")).wait();
  console.log("     Deployer registered as HOT wallet (placeholder)");

  // Safe-list the WalletRegistry and MultiSigWarm on the security token
  await (await token.setSafeList(walletRegistryAddress, true)).wait();
  console.log("     WalletRegistry safe-listed on SecurityToken");
  await (await token.setSafeList(multiSigWarmAddress, true)).wait();
  console.log("     MultiSigWarm safe-listed on SecurityToken");

  // OrderBook safe-listing (so escrow transfers succeed)
  await (await token.setSafeList(orderBookAddress, true)).wait();
  console.log("     OrderBook safe-listed on SecurityToken");

  // OracleCommittee: grant DEFAULT_ADMIN_ROLE on Compliance to OracleCommittee
  // so multi-oracle attestations can be consumed by the compliance contract
  console.log("\nConfiguring OracleCommittee...");
  await (await compliance.grantRole(COMPLIANCE_ADMIN_ROLE, oracleCommitteeAddress)).wait();
  console.log("     DEFAULT_ADMIN_ROLE granted to OracleCommittee on Compliance");

  // TokenFactoryV2: grant DEFAULT_ADMIN_ROLE on Compliance so V2 factory
  // can wire TOKEN_ROLE for newly deployed proxy tokens
  console.log("\nConfiguring TokenFactoryV2...");
  await (await compliance.grantRole(COMPLIANCE_ADMIN_ROLE, tokenFactoryV2Address)).wait();
  console.log("     DEFAULT_ADMIN_ROLE granted to TokenFactoryV2 on Compliance");

  // OrderBookFactory: safe-list on SecurityToken (factory-deployed order books
  // will still need individual safe-listing via createOrderBook post-hook)
  await (await token.setSafeList(orderBookFactoryAddress, true)).wait();
  console.log("     OrderBookFactory safe-listed on SecurityToken");

  // -----------------------------------------------------------------------
  // SEED INVESTOR1 (KYC + identity + tokens)
  // -----------------------------------------------------------------------
  const INVESTOR1 = "0x5e33E2E5333DD9b7b428AC38AE361E9b707046f3";
  console.log("\n══════════════════════════════════════════════════");
  console.log("  Seeding Investor1:", INVESTOR1);
  console.log("══════════════════════════════════════════════════");

  // Grant AGENT_ROLE on IdentityRegistry to deployer (needed for registerIdentity)
  const AGENT_ROLE_REG_DEPLOYER = await registry.AGENT_ROLE();
  const deployerHasAgent = await registry.hasRole(AGENT_ROLE_REG_DEPLOYER, deployer.address);
  if (!deployerHasAgent) {
    await (await registry.grantRole(AGENT_ROLE_REG_DEPLOYER, deployer.address)).wait();
    console.log("     AGENT_ROLE granted to deployer on IdentityRegistry");
  }

  // Register Investor1 identity
  const inv1Registered = await registry.contains(INVESTOR1);
  if (inv1Registered) {
    const existingId = await registry.identity(INVESTOR1);
    await (await registry.deleteIdentity(INVESTOR1)).wait();
    await (await registry.registerIdentity(INVESTOR1, existingId, "HK")).wait();
    console.log("     Investor1 re-registered (country: HK)");
  } else {
    const factoryId = await identityFactory.getIdentity(INVESTOR1);
    if (factoryId !== ethers.ZeroAddress) {
      await (await registry.registerIdentity(INVESTOR1, factoryId, "HK")).wait();
      console.log("     Investor1 registered with factory identity (country: HK)");
    } else {
      await (await registry.registerIdentity(INVESTOR1, ethers.ZeroAddress, "HK")).wait();
      console.log("     Investor1 registered (country: HK, auto-deploy identity)");
    }
  }

  // Set boolean KYC claims (topics 1-5)
  console.log("     Setting KYC claims (topics 1-5)...");
  for (const topic of [1, 2, 3, 4, 5]) {
    await (await registry.setClaim(INVESTOR1, topic, true)).wait();
  }
  console.log("     ✓ All 5 boolean claims set");

  // Issue cryptographic ERC-735 claims via ClaimIssuer
  console.log("     Issuing ERC-735 claims via ClaimIssuer...");
  const inv1IdentityAddr = await registry.identity(INVESTOR1);
  if (inv1IdentityAddr !== ethers.ZeroAddress) {
    for (const topic of [1, 2, 3, 4, 5]) {
      const claimData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [INVESTOR1, topic, 0]  // 0 = no expiry
      );
      const claimHash = await claimIssuer.getClaimHash(inv1IdentityAddr, topic, claimData);
      const signature = await deployer.signMessage(ethers.getBytes(claimHash));
      try {
        await (await registry.issueClaim(INVESTOR1, topic, claimIssuerAddress, signature, claimData)).wait();
      } catch (e) {
        // already exists — fine
      }
    }
    console.log("     ✓ ERC-735 claims issued");
  }

  // Verify investor
  const isVerified = await registry.isVerified(INVESTOR1);
  console.log(`     Investor1 isVerified: ${isVerified}`);

  // Mint HKSAT tokens
  const HKSAT_AMOUNT = ethers.parseUnits("10000", 18);
  await (await token.mint(INVESTOR1, HKSAT_AMOUNT)).wait();
  const hksatBal = await token.balanceOf(INVESTOR1);
  console.log(`     ✓ HKSAT minted: ${ethers.formatUnits(hksatBal, 18)}`);

  // Mint THKD tokens
  const THKD_AMOUNT = ethers.parseUnits("5000000", 6);
  await (await cashToken.mint(INVESTOR1, THKD_AMOUNT)).wait();
  const thkdBal = await cashToken.balanceOf(INVESTOR1);
  console.log(`     ✓ THKD minted: ${ethers.formatUnits(thkdBal, 6)}`);

  console.log("     ✅ Investor1 seeded successfully");

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
    console.log("\nUpdating frontend config (network + contract addresses)...");
    let content = fs.readFileSync(contractsFile, "utf-8");

    // ── Auto-detect chain ID from the running node ──
    const network = await ethers.provider.getNetwork();
    const liveChainId = Number(network.chainId);
    const chainName = liveChainId === 31337 ? "Hardhat Devnet" : `Devnet (${liveChainId})`;
    console.log(`     Chain ID detected: ${liveChainId} → ${chainName}`);

    // Replace the NETWORK_CONFIG block
    const oldNetworkBlock =
      /export const NETWORK_CONFIG\s*=\s*\{[^}]+\};/;
    const newNetworkBlock = `export const NETWORK_CONFIG = {
  chainId: ${liveChainId},
  chainName: '${chainName}',
  rpcUrl: 'http://127.0.0.1:8545',
  blockExplorer: '',
};`;

    if (oldNetworkBlock.test(content)) {
      content = content.replace(oldNetworkBlock, newNetworkBlock);
      console.log("     ✓ NETWORK_CONFIG updated");
    } else {
      console.log(
        "     ⚠ Could not find NETWORK_CONFIG block — update manually"
      );
    }

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
  oracleCommittee: '${oracleCommitteeAddress}',
  orderBookFactory: '${orderBookFactoryAddress}',
  orderBook: '${orderBookAddress}',
  tokenFactoryV2: '${tokenFactoryV2Address}',
  systemHealthCheck: '${systemHealthCheckAddress}',
  governorFactory: '${governorFactoryAddress}',
};`;

    if (oldBlock.test(content)) {
      content = content.replace(oldBlock, newBlock);
      console.log("     ✓ CONTRACT_ADDRESSES updated");
    } else {
      console.log(
        "     ⚠ Could not find CONTRACT_ADDRESSES block — update manually"
      );
    }

    fs.writeFileSync(contractsFile, content, "utf-8");
    console.log("     ✓ frontend/src/config/contracts.ts saved");
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
    `║ OracleCommittee       : ${oracleCommitteeAddress}  ║`
  );
  console.log(
    `║ OrderBookFactory      : ${orderBookFactoryAddress}  ║`
  );
  console.log(
    `║ OrderBook             : ${orderBookAddress}  ║`
  );
  console.log(
    `║ TokenFactoryV2        : ${tokenFactoryV2Address}  ║`
  );
  console.log(
    `║ SystemHealthCheck     : ${systemHealthCheckAddress}  ║`
  );
  console.log(
    `║ GovernorFactory       : ${governorFactoryAddress}  ║`
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
    `║ Governance: delay=${VOTING_DELAY}s period=${VOTING_PERIOD}s quorum=${QUORUM_PCT}%       ║`
  );
  console.log(
    `║ Proposal threshold: ${ethers.formatEther(PROPOSAL_THRESHOLD)} tokens (1%)              ║`
  );
  console.log(
    `║ Timelock delay: ${TIMELOCK_MIN_DELAY}s (48h) | Identity-locked voting  ║`
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════╣"
  );
  console.log(
    `║ Investor1: ${INVESTOR1}              ║`
  );
  console.log(
    `║   HKSAT: 10,000     THKD: 5,000,000     KYC: ✓              ║`
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
