/**
 * @title seed-investor.js
 * @notice Registers Investor1, issues KYC claims, and mints tokens
 *         on the CURRENT deployment. Run after deploy-and-update-frontend.js.
 *
 * Works with both Hardhat Network (auto-mine) and Besu (Engine API).
 *
 * Usage:
 *   npx hardhat run scripts/seed-investor.js --network localhost
 */

const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// Embedded Engine-API block producer (same as deploy script)
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
// Detect whether Engine API is available (Besu) or not (Hardhat)
// ---------------------------------------------------------------------------
async function hasEngineAPI() {
  try {
    const res = await fetch(ENGINE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "engine_exchangeCapabilities", params: [[]], id: 1 }),
    });
    const json = await res.json();
    return !json.error;
  } catch {
    return false;
  }
}

function noopBlockProducer() {
  return { stop: async () => {} };
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function main() {
  const useEngine = await hasEngineAPI();
  if (useEngine) {
    console.log("Starting embedded block producer (Besu detected)...\n");
  } else {
    console.log("Hardhat auto-mine detected — block producer skipped.\n");
  }
  const blockProducer = useEngine ? startBlockProducer() : noopBlockProducer();

  const [deployer] = await ethers.getSigners();

  // Investor1 address (your MetaMask account)
  const INVESTOR1 = "0x5e33E2E5333DD9b7b428AC38AE361E9b707046f3";

  // ── Load deployed contracts (read from frontend config) ──
  const fs = require("fs");
  const path = require("path");
  const configPath = path.join(__dirname, "..", "frontend", "src", "config", "contracts.ts");
  const configSrc = fs.readFileSync(configPath, "utf8");
  const pick = (key) => {
    const m = configSrc.match(new RegExp(`${key}:\\s*'(0x[0-9a-fA-F]+)'`));
    if (!m) throw new Error(`Address not found for ${key} in contracts.ts`);
    return m[1];
  };
  const registryAddr        = pick("identityRegistry");
  const complianceAddr      = pick("compliance");
  const tokenAddr           = pick("securityToken");
  const cashAddr            = pick("cashToken");
  const claimIssuerAddr     = pick("claimIssuer");
  const identityFactoryAddr = pick("identityFactory");

  const registry       = await ethers.getContractAt("HKSTPIdentityRegistry", registryAddr);
  const token          = await ethers.getContractAt("HKSTPSecurityToken", tokenAddr);
  const cashToken      = await ethers.getContractAt("MockCashToken", cashAddr);
  const claimIssuer    = await ethers.getContractAt("ClaimIssuer", claimIssuerAddr);
  const identityFactory = await ethers.getContractAt("IdentityFactory", identityFactoryAddr);

  console.log("Deployer:", deployer.address);
  console.log("Investor1:", INVESTOR1);
  console.log();

  // ── 1. Grant AGENT_ROLE on IdentityRegistry to deployer (if not already) ──
  const AGENT_ROLE = await registry.AGENT_ROLE();
  const hasAgent = await registry.hasRole(AGENT_ROLE, deployer.address);
  if (!hasAgent) {
    console.log("Granting AGENT_ROLE on IdentityRegistry to deployer...");
    await (await registry.grantRole(AGENT_ROLE, deployer.address)).wait();
    console.log("     ✓ AGENT_ROLE granted");
  }

  // ── 2. Register Investor1 identity (reuse existing identity from factory if any) ──
  const isRegistered = await registry.contains(INVESTOR1);
  if (isRegistered) {
    // Already registered — save identity, delete, then re-register with same identity
    const existingIdentity = await registry.identity(INVESTOR1);
    console.log("Deleting stale Investor1 registry entry for re-registration...");
    console.log("     Preserving identity contract:", existingIdentity);
    await (await registry.deleteIdentity(INVESTOR1)).wait();
    console.log("     ✓ Old registry entry deleted");
    console.log("Re-registering Investor1 with preserved identity...");
    await (await registry.registerIdentity(INVESTOR1, existingIdentity, "HK")).wait();
    console.log("     ✓ Investor1 re-registered (country: HK)");
  } else {
    // Not in registry — check if IdentityFactory already deployed an identity for this address
    const factoryIdentity = await identityFactory.getIdentity(INVESTOR1);
    if (factoryIdentity !== ethers.ZeroAddress) {
      console.log("Found existing identity from IdentityFactory:", factoryIdentity);
      console.log("Registering Investor1 with pre-existing identity...");
      await (await registry.registerIdentity(INVESTOR1, factoryIdentity, "HK")).wait();
      console.log("     ✓ Investor1 registered with factory identity (country: HK)");
    } else {
      console.log("Registering Investor1 identity (auto-deploy via factory)...");
      await (await registry.registerIdentity(INVESTOR1, ethers.ZeroAddress, "HK")).wait();
      console.log("     ✓ Investor1 registered (country: HK)");
    }
  }

  // ── 3. Issue KYC claims (topics 1-5) via boolean claims ──
  console.log("Setting boolean KYC claims (topics 1-5)...");
  for (const topic of [1, 2, 3, 4, 5]) {
    await (await registry.setClaim(INVESTOR1, topic, true)).wait();
    console.log(`     ✓ Claim topic ${topic} set`);
  }

  // ── 4. Issue cryptographic ERC-735 claims via ClaimIssuer ──
  console.log("Issuing cryptographic claims via ClaimIssuer...");
  const identityAddr = await registry.identity(INVESTOR1);
  if (identityAddr !== ethers.ZeroAddress) {
    for (const topic of [1, 2, 3, 4, 5]) {
      // Encode as (address investor, uint256 topic, uint256 expiry)
      // expiry = 0 means no expiry — matches the contract's abi.decode check
      const claimData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "uint256", "uint256"],
        [INVESTOR1, topic, 0]  // 0 = no expiry
      );
      const claimHash = await claimIssuer.getClaimHash(identityAddr, topic, claimData);
      const signature = await deployer.signMessage(ethers.getBytes(claimHash));

      try {
        await (await registry.issueClaim(INVESTOR1, topic, claimIssuerAddr, signature, claimData)).wait();
        console.log(`     ✓ ERC-735 claim topic ${topic} issued`);
      } catch (e) {
        // May already exist — that's fine
        console.log(`     Claim topic ${topic}: ${e.reason || 'already exists'}`);
      }
    }
  }

  // ── 5. Verify investor is now verified ──
  const isVerified = await registry.isVerified(INVESTOR1);
  console.log(`\nInvestor1 isVerified: ${isVerified}`);

  // ── 6. Mint HKSAT tokens ──
  console.log("\nMinting 10,000 HKSAT to Investor1...");
  const HKSAT_AMOUNT = ethers.parseUnits("10000", 18);
  await (await token.mint(INVESTOR1, HKSAT_AMOUNT)).wait();
  const hksatBal = await token.balanceOf(INVESTOR1);
  console.log(`     ✓ HKSAT balance: ${ethers.formatUnits(hksatBal, 18)}`);

  // ── 7. Mint THKD tokens ──
  console.log("Minting 5,000,000 THKD to Investor1...");
  const THKD_AMOUNT = ethers.parseUnits("5000000", 6);
  await (await cashToken.mint(INVESTOR1, THKD_AMOUNT)).wait();
  const thkdBal = await cashToken.balanceOf(INVESTOR1);
  console.log(`     ✓ THKD balance: ${ethers.formatUnits(thkdBal, 6)}`);

  // ── Done ──
  await blockProducer.stop();
  console.log("\n══════════════════════════════════════════════");
  console.log("  Investor1 seeded successfully!");
  console.log(`  HKSAT: ${ethers.formatUnits(hksatBal, 18)}`);
  console.log(`  THKD:  ${ethers.formatUnits(thkdBal, 6)}`);
  console.log(`  KYC:   ${isVerified ? 'Verified ✓' : 'Not Verified ✗'}`);
  console.log("══════════════════════════════════════════════");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
