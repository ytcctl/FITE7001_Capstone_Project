/**
 * @title integration/besu-e2e.test.js
 * @notice End-to-end integration test suite designed to run against a live
 *         Hyperledger Besu node (local devnet).
 *
 * This test deploys the full TokenHub contract suite, configures roles,
 * registers identities, and performs atomic DvP settlement — all on-chain.
 *
 * Prerequisites:
 *   1. Besu node running at http://127.0.0.1:8545 (--network=dev, chain ID 1337)
 *      → .\besu\start-besu.ps1 -Detach
 *   2. Environment loaded from .env.besu
 *      → copy .env.besu to .env  OR  set vars manually
 *   3. npm install (with dotenv added)
 *
 * Run:
 *   npx hardhat test test/integration/besu-e2e.test.js --network besu
 *   # or
 *   npm run test:besu
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Besu E2E Integration — Full TokenHub Lifecycle", function () {
  // Besu block times are ~2s; give generous timeouts
  this.timeout(120_000);

  let deployer, operator, agent, seller, buyer;

  // Contracts
  let registry, compliance, securityToken, cashToken, dvp;

  // Amounts
  const MINT_AMOUNT     = ethers.parseUnits("10000", 18);
  const SECURITY_AMOUNT = ethers.parseUnits("500", 18);
  const CASH_AMOUNT     = ethers.parseUnits("25000", 6); // 25,000 THKD
  const MATCH_ID        = ethers.keccak256(ethers.toUtf8Bytes("BESU_E2E_001"));

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** Wait for N seconds (real-time, for Besu block production) */
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Build an EIP-712 attestation signature for the Compliance contract */
  async function signAttestation(from, to, amount, expiry, nonce, signer) {
    const domain = {
      name: "HKSTPCompliance",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await compliance.getAddress(),
    };
    const types = {
      Attestation: [
        { name: "from",   type: "address" },
        { name: "to",     type: "address" },
        { name: "amount", type: "uint256" },
        { name: "expiry", type: "uint256" },
        { name: "nonce",  type: "uint256" },
      ],
    };
    return signer.signTypedData(domain, types, { from, to, amount, expiry, nonce });
  }

  /** Get a future deadline timestamp */
  async function futureDeadline(offsetSeconds = 600) {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + offsetSeconds;
  }

  // ------------------------------------------------------------------
  // 1. Verify Besu connectivity & fund accounts
  // ------------------------------------------------------------------
  describe("Phase 1 — Network Connectivity", function () {
    it("should connect to Besu and return the expected chain ID", async function () {
      const expectedChainId = parseInt(process.env.BESU_CHAIN_ID || "1337");
      const network = await ethers.provider.getNetwork();
      console.log(`    Connected to chain ID: ${network.chainId}`);
      expect(Number(network.chainId)).to.equal(expectedChainId);
    });

    it("should assign signers and fund them from the dev account", async function () {
      const signers = await ethers.getSigners();
      expect(signers.length).to.be.gte(5);

      [deployer, operator, agent, seller, buyer] = signers;

      // In Besu --network=dev only account 0 is pre-funded.
      // Send 100 ETH to each of the remaining accounts so they can transact.
      const fundAmount = ethers.parseEther("100");
      for (const s of [operator, agent, seller, buyer]) {
        const bal = await ethers.provider.getBalance(s.address);
        if (bal < fundAmount) {
          const tx = await deployer.sendTransaction({
            to: s.address,
            value: fundAmount,
          });
          await tx.wait();
          console.log(`    Funded ${s.address} with 100 ETH`);
        }
      }
    });

    it("should have signers with non-zero balances", async function () {
      for (const s of [deployer, operator, agent, seller, buyer]) {
        const bal = await ethers.provider.getBalance(s.address);
        console.log(`    ${s.address} — ${ethers.formatEther(bal)} ETH`);
        expect(bal).to.be.gt(0n);
      }
    });
  });

  // ------------------------------------------------------------------
  // 2. Deploy all contracts
  // ------------------------------------------------------------------
  describe("Phase 2 — Contract Deployment", function () {
    it("should deploy HKSTPIdentityRegistry", async function () {
      const Factory = await ethers.getContractFactory("HKSTPIdentityRegistry", deployer);
      registry = await Factory.deploy(deployer.address);
      await registry.waitForDeployment();
      const addr = await registry.getAddress();
      console.log(`    HKSTPIdentityRegistry: ${addr}`);
      expect(addr).to.be.properAddress;
    });

    it("should deploy HKSTPCompliance", async function () {
      const Factory = await ethers.getContractFactory("HKSTPCompliance", deployer);
      compliance = await Factory.deploy(deployer.address, deployer.address);
      await compliance.waitForDeployment();
      const addr = await compliance.getAddress();
      console.log(`    HKSTPCompliance: ${addr}`);
      expect(addr).to.be.properAddress;
    });

    it("should deploy HKSTPSecurityToken", async function () {
      const Factory = await ethers.getContractFactory("HKSTPSecurityToken", deployer);
      securityToken = await Factory.deploy(
        "HKSTP Alpha Startup Token",
        "HKSAT",
        await registry.getAddress(),
        await compliance.getAddress(),
        ethers.ZeroAddress,
        deployer.address
      );
      await securityToken.waitForDeployment();
      const addr = await securityToken.getAddress();
      console.log(`    HKSTPSecurityToken: ${addr}`);
      expect(await securityToken.name()).to.equal("HKSTP Alpha Startup Token");
    });

    it("should deploy MockCashToken (THKD)", async function () {
      const Factory = await ethers.getContractFactory("MockCashToken", deployer);
      cashToken = await Factory.deploy("Tokenized HKD", "THKD", 6, deployer.address);
      await cashToken.waitForDeployment();
      const addr = await cashToken.getAddress();
      console.log(`    MockCashToken: ${addr}`);
      expect(await cashToken.symbol()).to.equal("THKD");
    });

    it("should deploy DvPSettlement", async function () {
      const Factory = await ethers.getContractFactory("DvPSettlement", deployer);
      dvp = await Factory.deploy(deployer.address);
      await dvp.waitForDeployment();
      const addr = await dvp.getAddress();
      console.log(`    DvPSettlement: ${addr}`);
      expect(addr).to.be.properAddress;
    });
  });

  // ------------------------------------------------------------------
  // 3. Configure roles and permissions
  // ------------------------------------------------------------------
  describe("Phase 3 — Role Configuration", function () {
    it("should grant TOKEN_ROLE on Compliance to HKSTPSecurityToken", async function () {
      const TOKEN_ROLE = await compliance.TOKEN_ROLE();
      await (await compliance.connect(deployer).grantRole(TOKEN_ROLE, await securityToken.getAddress())).wait();
      expect(await compliance.hasRole(TOKEN_ROLE, await securityToken.getAddress())).to.be.true;
    });

    it("should grant AGENT_ROLE on SecurityToken", async function () {
      const AGENT_ROLE = await securityToken.AGENT_ROLE();
      await (await securityToken.connect(deployer).grantRole(AGENT_ROLE, agent.address)).wait();
      expect(await securityToken.hasRole(AGENT_ROLE, agent.address)).to.be.true;
    });

    it("should grant AGENT_ROLE on IdentityRegistry", async function () {
      const AGENT_ROLE = await registry.AGENT_ROLE();
      await (await registry.connect(deployer).grantRole(AGENT_ROLE, agent.address)).wait();
      expect(await registry.hasRole(AGENT_ROLE, agent.address)).to.be.true;
    });

    it("should grant OPERATOR_ROLE on DvPSettlement", async function () {
      const OPERATOR_ROLE = await dvp.OPERATOR_ROLE();
      await (await dvp.connect(deployer).grantRole(OPERATOR_ROLE, operator.address)).wait();
      expect(await dvp.hasRole(OPERATOR_ROLE, operator.address)).to.be.true;
    });
  });

  // ------------------------------------------------------------------
  // 4. Register investor identities (KYC/AML)
  // ------------------------------------------------------------------
  describe("Phase 4 — Identity Registration & KYC", function () {
    it("should register and verify seller", async function () {
      await (await registry.connect(agent).registerIdentity(seller.address, ethers.ZeroAddress, "HK")).wait();
      for (let topic = 1; topic <= 5; topic++) {
        await (await registry.connect(agent).setClaim(seller.address, topic, true)).wait();
      }
      expect(await registry.isVerified(seller.address)).to.be.true;
      console.log(`    Seller ${seller.address} — KYC verified`);
    });

    it("should register and verify buyer", async function () {
      await (await registry.connect(agent).registerIdentity(buyer.address, ethers.ZeroAddress, "HK")).wait();
      for (let topic = 1; topic <= 5; topic++) {
        await (await registry.connect(agent).setClaim(buyer.address, topic, true)).wait();
      }
      expect(await registry.isVerified(buyer.address)).to.be.true;
      console.log(`    Buyer ${buyer.address} — KYC verified`);
    });
  });

  // ------------------------------------------------------------------
  // 5. Minting
  // ------------------------------------------------------------------
  describe("Phase 5 — Asset Minting", function () {
    it("should mint security tokens to seller", async function () {
      await (await securityToken.connect(agent).mint(seller.address, MINT_AMOUNT)).wait();
      const bal = await securityToken.balanceOf(seller.address);
      console.log(`    Seller security token balance: ${ethers.formatUnits(bal, 18)}`);
      expect(bal).to.equal(MINT_AMOUNT);
    });

    it("should mint THKD (cash tokens) to buyer", async function () {
      await (await cashToken.connect(deployer).mint(buyer.address, CASH_AMOUNT)).wait();
      const bal = await cashToken.balanceOf(buyer.address);
      console.log(`    Buyer THKD balance: ${ethers.formatUnits(bal, 6)}`);
      expect(bal).to.equal(CASH_AMOUNT);
    });
  });

  // ------------------------------------------------------------------
  // 6. DvP Settlement (end-to-end atomic trade)
  // ------------------------------------------------------------------
  describe("Phase 6 — Atomic DvP Settlement", function () {
    it("should have seller approve DvP for security tokens", async function () {
      await (await securityToken.connect(seller).approve(await dvp.getAddress(), SECURITY_AMOUNT)).wait();
      const allowance = await securityToken.allowance(seller.address, await dvp.getAddress());
      expect(allowance).to.equal(SECURITY_AMOUNT);
    });

    it("should have buyer approve DvP for cash tokens", async function () {
      await (await cashToken.connect(buyer).approve(await dvp.getAddress(), CASH_AMOUNT)).wait();
      const allowance = await cashToken.allowance(buyer.address, await dvp.getAddress());
      expect(allowance).to.equal(CASH_AMOUNT);
    });

    it("should create a settlement (operator)", async function () {
      const deadline = await futureDeadline(600);
      const tx = await dvp.connect(operator).createSettlement(
        seller.address,
        buyer.address,
        await securityToken.getAddress(),
        SECURITY_AMOUNT,
        await cashToken.getAddress(),
        CASH_AMOUNT,
        deadline,
        MATCH_ID
      );
      await tx.wait();

      const s = await dvp.getSettlement(0);
      expect(s.seller).to.equal(seller.address);
      expect(s.buyer).to.equal(buyer.address);
      expect(s.status).to.equal(0); // Pending
      console.log(`    Settlement #0 created — Pending`);
    });

    it("should execute settlement atomically (both legs)", async function () {
      const sellerSecBefore  = await securityToken.balanceOf(seller.address);
      const buyerSecBefore   = await securityToken.balanceOf(buyer.address);
      const sellerCashBefore = await cashToken.balanceOf(seller.address);
      const buyerCashBefore  = await cashToken.balanceOf(buyer.address);

      console.log(`    PRE-SETTLEMENT:`);
      console.log(`      Seller: ${ethers.formatUnits(sellerSecBefore, 18)} HKSAT, ${ethers.formatUnits(sellerCashBefore, 6)} THKD`);
      console.log(`      Buyer:  ${ethers.formatUnits(buyerSecBefore, 18)} HKSAT, ${ethers.formatUnits(buyerCashBefore, 6)} THKD`);

      const tx = await dvp.connect(operator).executeSettlement(0);
      const receipt = await tx.wait();
      console.log(`    Settlement executed in tx: ${receipt.hash}`);

      const sellerSecAfter  = await securityToken.balanceOf(seller.address);
      const buyerSecAfter   = await securityToken.balanceOf(buyer.address);
      const sellerCashAfter = await cashToken.balanceOf(seller.address);
      const buyerCashAfter  = await cashToken.balanceOf(buyer.address);

      console.log(`    POST-SETTLEMENT:`);
      console.log(`      Seller: ${ethers.formatUnits(sellerSecAfter, 18)} HKSAT, ${ethers.formatUnits(sellerCashAfter, 6)} THKD`);
      console.log(`      Buyer:  ${ethers.formatUnits(buyerSecAfter, 18)} HKSAT, ${ethers.formatUnits(buyerCashAfter, 6)} THKD`);

      // Verify Leg 1: security tokens moved seller → buyer
      expect(sellerSecAfter).to.equal(sellerSecBefore - SECURITY_AMOUNT);
      expect(buyerSecAfter).to.equal(buyerSecBefore + SECURITY_AMOUNT);

      // Verify Leg 2: cash tokens moved buyer → seller
      expect(buyerCashAfter).to.equal(buyerCashBefore - CASH_AMOUNT);
      expect(sellerCashAfter).to.equal(sellerCashBefore + CASH_AMOUNT);

      // Verify settlement status = Settled
      const s = await dvp.getSettlement(0);
      expect(s.status).to.equal(1); // Settled
    });

    it("should not allow re-execution of settled trade", async function () {
      await expect(dvp.connect(operator).executeSettlement(0))
        .to.be.revertedWith("DvPSettlement: not pending");
    });
  });

  // ------------------------------------------------------------------
  // 7. Compliance enforcement (negative path)
  // ------------------------------------------------------------------
  describe("Phase 7 — Compliance Enforcement", function () {
    it("should block transfer to unverified address", async function () {
      // 'operator' is NOT registered in the IdentityRegistry
      await expect(
        securityToken.connect(buyer).transfer(operator.address, ethers.parseUnits("1", 18))
      ).to.be.reverted;
      console.log(`    Transfer to unverified address correctly blocked`);
    });
  });

  // ------------------------------------------------------------------
  // 8. Settlement cancellation
  // ------------------------------------------------------------------
  describe("Phase 8 — Settlement Cancellation", function () {
    it("should create and then cancel a settlement", async function () {
      // Need fresh approvals
      await (await securityToken.connect(seller).approve(await dvp.getAddress(), SECURITY_AMOUNT)).wait();
      await (await cashToken.connect(buyer).approve(await dvp.getAddress(), CASH_AMOUNT)).wait();

      const deadline = await futureDeadline(600);
      const matchId2 = ethers.keccak256(ethers.toUtf8Bytes("BESU_E2E_CANCEL"));
      await (await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), SECURITY_AMOUNT,
        await cashToken.getAddress(), CASH_AMOUNT,
        deadline, matchId2
      )).wait();

      const newId = await dvp.settlementCount() - 1n;
      await (await dvp.connect(operator).cancelSettlement(newId)).wait();

      const s = await dvp.getSettlement(newId);
      expect(s.status).to.equal(3); // Cancelled
      console.log(`    Settlement #${newId} cancelled`);
    });
  });
});
