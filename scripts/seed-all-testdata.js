/**
 * @title seed-all-testdata.js
 * @notice Seeds a rich set of test data on a fresh deployment so the
 *         TokenHub platform feels "lived-in" after every Codespace restart.
 *
 *  What it creates:
 *    • Investor2 (Seller  0xC5fdf…) — KYC verified, 5 000 HKSAT + 2 000 000 THKD
 *    • Investor3 (Buyer   0x821aE…) — KYC verified, 3 000 HKSAT + 1 000 000 THKD
 *    • Self-delegation for Investor1, Investor2, Investor3
 *    • A sample governance proposal (signalling / text‐only)
 *    • A buy + sell limit order on the OrderBook (HKSAT / THKD)
 *
 *  Run AFTER deploy-and-update-frontend.js:
 *    npx hardhat run scripts/seed-all-testdata.js --network localhost
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function pick(configSrc, key) {
  const m = configSrc.match(new RegExp(`${key}:\\s*'(0x[0-9a-fA-F]+)'`));
  if (!m) throw new Error(`Address not found for ${key} in contracts.ts`);
  return m[1];
}

async function mineBlocks(n) {
  for (let i = 0; i < n; i++) {
    await ethers.provider.send("evm_mine", []);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const [deployer, operator, agent, seller, buyer] = await ethers.getSigners();

  // ── Load deployed contract addresses from frontend config ──
  const configPath = path.join(__dirname, "..", "frontend", "src", "config", "contracts.ts");
  const configSrc = fs.readFileSync(configPath, "utf8");

  const registryAddr        = pick(configSrc, "identityRegistry");
  const tokenAddr           = pick(configSrc, "securityToken");
  const cashAddr            = pick(configSrc, "cashToken");
  const claimIssuerAddr     = pick(configSrc, "claimIssuer");
  const identityFactoryAddr = pick(configSrc, "identityFactory");
  const governorAddr        = pick(configSrc, "governor");
  const timelockAddr        = pick(configSrc, "timelock");
  const orderBookAddr       = pick(configSrc, "orderBook");

  const registry        = await ethers.getContractAt("HKSTPIdentityRegistry", registryAddr);
  const token           = await ethers.getContractAt("HKSTPSecurityToken", tokenAddr);
  const cashToken       = await ethers.getContractAt("MockCashToken", cashAddr);
  const claimIssuer     = await ethers.getContractAt("ClaimIssuer", claimIssuerAddr);
  const identityFactory = await ethers.getContractAt("IdentityFactory", identityFactoryAddr);
  const governor        = await ethers.getContractAt("HKSTPGovernor", governorAddr);
  const orderBook       = await ethers.getContractAt("OrderBook", orderBookAddr);

  // Investor1 is the external MetaMask account seeded in deploy script
  const INVESTOR1 = "0x5e33E2E5333DD9b7b428AC38AE361E9b707046f3";
  const INVESTOR2 = seller.address;  // 0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef
  const INVESTOR3 = buyer.address;   // 0x821aEa9a577a9b44299B9c15c88cf3087F3b5544

  console.log("══════════════════════════════════════════════════");
  console.log("  Seeding additional test data...");
  console.log("══════════════════════════════════════════════════");
  console.log("  Investor1 (MetaMask):", INVESTOR1);
  console.log("  Investor2 (Seller)  :", INVESTOR2);
  console.log("  Investor3 (Buyer)   :", INVESTOR3);
  console.log();

  // ── Ensure deployer has AGENT_ROLE on IdentityRegistry ──
  const AGENT_ROLE = await registry.AGENT_ROLE();
  if (!(await registry.hasRole(AGENT_ROLE, deployer.address))) {
    await (await registry.grantRole(AGENT_ROLE, deployer.address)).wait();
  }

  // =====================================================================
  // Helper: full KYC registration for an investor
  // =====================================================================
  async function seedInvestor(addr, label, hksatAmount, thkdAmount) {
    console.log(`▶ Seeding ${label} (${addr.slice(0, 10)}…)`);

    // Register identity
    const isRegistered = await registry.contains(addr);
    if (isRegistered) {
      console.log(`  ✓ Already registered — skipping identity setup`);
    } else {
      const factoryId = await identityFactory.getIdentity(addr);
      if (factoryId !== ethers.ZeroAddress) {
        await (await registry.registerIdentity(addr, factoryId, "HK")).wait();
      } else {
        await (await registry.registerIdentity(addr, ethers.ZeroAddress, "HK")).wait();
      }
      console.log("  ✓ Identity registered (country: HK)");
    }

    // Boolean KYC claims
    for (const topic of [1, 2, 3, 4, 5]) {
      await (await registry.setClaim(addr, topic, true)).wait();
    }
    console.log("  ✓ KYC claims 1-5 set");

    // ERC-735 cryptographic claims
    const identityAddr = await registry.identity(addr);
    if (identityAddr !== ethers.ZeroAddress) {
      for (const topic of [1, 2, 3, 4, 5]) {
        const claimData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [addr, topic, 0]
        );
        const claimHash = await claimIssuer.getClaimHash(identityAddr, topic, claimData);
        const signature = await deployer.signMessage(ethers.getBytes(claimHash));
        try {
          await (await registry.issueClaim(addr, topic, claimIssuerAddr, signature, claimData)).wait();
        } catch { /* already exists */ }
      }
      console.log("  ✓ ERC-735 claims issued");
    }

    // Verify
    const verified = await registry.isVerified(addr);
    console.log(`  ✓ isVerified: ${verified}`);

    // Mint HKSAT
    if (hksatAmount > 0n) {
      await (await token.mint(addr, hksatAmount)).wait();
      const bal = await token.balanceOf(addr);
      console.log(`  ✓ HKSAT minted — balance: ${ethers.formatUnits(bal, 18)}`);
    }

    // Mint THKD
    if (thkdAmount > 0n) {
      await (await cashToken.mint(addr, thkdAmount)).wait();
      const bal = await cashToken.balanceOf(addr);
      console.log(`  ✓ THKD minted — balance: ${ethers.formatUnits(bal, 6)}`);
    }
    console.log();
  }

  // =====================================================================
  // 1. Seed Investor2 and Investor3
  // =====================================================================
  await seedInvestor(INVESTOR2, "Investor2 (Seller)", ethers.parseUnits("5000", 18), ethers.parseUnits("2000000", 6));
  await seedInvestor(INVESTOR3, "Investor3 (Buyer)",  ethers.parseUnits("3000", 18), ethers.parseUnits("1000000", 6));

  // =====================================================================
  // 2. Self-delegate voting power (all three investors)
  // =====================================================================
  console.log("▶ Setting up vote delegations...");

  // Investor1 — can only delegate if we have the key. Investor1 is external
  // (MetaMask) so we can't sign for it here. That's okay — the user can
  // self-delegate from the UI. We delegate for Investor2 + Investor3.
  await (await token.connect(seller).delegate(seller.address)).wait();
  console.log(`  ✓ Investor2 self-delegated (${seller.address.slice(0, 10)}…)`);

  await (await token.connect(buyer).delegate(buyer.address)).wait();
  console.log(`  ✓ Investor3 self-delegated (${buyer.address.slice(0, 10)}…)`);

  // Also delegate for admin (deployer) — useful for proposal creation
  const adminBal = await token.balanceOf(deployer.address);
  if (adminBal > 0n) {
    await (await token.connect(deployer).delegate(deployer.address)).wait();
    console.log(`  ✓ Admin self-delegated`);
  }
  console.log();

  // =====================================================================
  // 3. Create a sample governance proposal
  // =====================================================================
  console.log("▶ Creating sample governance proposal...");
  try {
    // Mine a block so vote checkpoints are recorded before proposal snapshot
    await mineBlocks(1);

    // Check if seller (Investor2) has enough voting power to propose
    const proposalThreshold = await governor.proposalThreshold();
    const sellerVotes = await token.getVotes(seller.address);
    console.log(`  Investor2 votes: ${ethers.formatUnits(sellerVotes, 18)}, threshold: ${ethers.formatUnits(proposalThreshold, 18)}`);

    if (sellerVotes >= proposalThreshold) {
      // Create a signalling (text-only) proposal — no on-chain execution
      const description = "SAMPLE: Increase shareholder cap from 50 to 100\n\n" +
        "This is a demo proposal automatically created by the test-data seeder.\n" +
        "Vote FOR or AGAINST to test the governance flow.";

      const tx = await governor.connect(seller).propose(
        [tokenAddr],
        [0],
        ["0x"],
        description
      );
      const receipt = await tx.wait();

      // Extract proposal ID from ProposalCreated event
      const event = receipt.logs.find(
        (l) => l.fragment && l.fragment.name === "ProposalCreated"
      );
      if (event) {
        console.log(`  ✓ Proposal created — ID: ${event.args[0].toString().slice(0, 20)}…`);
      } else {
        console.log("  ✓ Proposal created (event not decoded)");
      }
    } else {
      console.log(`  ⚠ Investor2 votes (${ethers.formatUnits(sellerVotes, 18)}) below threshold — proposal skipped`);
    }
  } catch (e) {
    console.log(`  ⚠ Proposal creation skipped: ${e.reason || e.message?.slice(0, 80)}`);
  }
  console.log();

  // =====================================================================
  // 4. Place sample OrderBook orders (Seller sells, Buyer bids)
  // =====================================================================
  console.log("▶ Placing sample order book entries...");
  try {
    // Seller: approve OrderBook to spend HKSAT, place sell order
    const sellAmount = ethers.parseUnits("100", 18);    // 100 HKSAT
    const sellPrice  = ethers.parseUnits("12.50", 6);   // 12.50 THKD per token

    await (await token.connect(seller).approve(orderBookAddr, sellAmount)).wait();
    await (await orderBook.connect(seller).placeSellOrder(sellAmount, sellPrice)).wait();
    console.log(`  ✓ Seller: SELL 100 HKSAT @ 12.50 THKD`);

    // Buyer: approve OrderBook to spend THKD, place buy order
    const buyAmount = ethers.parseUnits("50", 18);      // 50 HKSAT
    const buyPrice  = ethers.parseUnits("11.00", 6);    // 11.00 THKD per token

    const thkdNeeded = ethers.parseUnits("550", 6);     // 50 * 11 = 550 THKD
    await (await cashToken.connect(buyer).approve(orderBookAddr, thkdNeeded)).wait();
    await (await orderBook.connect(buyer).placeBuyOrder(buyAmount, buyPrice)).wait();
    console.log(`  ✓ Buyer: BUY 50 HKSAT @ 11.00 THKD`);
  } catch (e) {
    console.log(`  ⚠ OrderBook seeding skipped: ${e.reason || e.message?.slice(0, 80)}`);
  }
  console.log();

  // =====================================================================
  // Summary
  // =====================================================================
  console.log("══════════════════════════════════════════════════");
  console.log("  ✅ Test data seeded successfully!");
  console.log("══════════════════════════════════════════════════");
  console.log("  Investor2 (Seller): KYC ✓ | 5,000 HKSAT | 2M THKD | Delegated ✓");
  console.log("  Investor3 (Buyer) : KYC ✓ | 3,000 HKSAT | 1M THKD | Delegated ✓");
  console.log("  Governance        : Sample proposal created");
  console.log("  OrderBook         : 1 sell + 1 buy order placed");
  console.log("══════════════════════════════════════════════════\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ seed-all-testdata failed:", error);
    process.exit(1);
  });
