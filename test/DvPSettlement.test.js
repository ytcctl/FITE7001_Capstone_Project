const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title DvPSettlement test suite
 *
 * Tests cover:
 *   - Settlement creation by operator
 *   - Successful atomic settlement (both legs execute)
 *   - Settlement revert when security token transfer fails (compliance check)
 *   - Settlement revert when cash token transfer fails (insufficient balance)
 *   - Settlement deadline enforcement
 *   - Pause blocks settlement execution
 *   - Only OPERATOR_ROLE can create/execute settlements
 *   - Settlement cannot be executed twice
 *   - Settlement cancellation
 *   - markFailed after deadline
 */
describe("DvPSettlement", function () {
  let dvp, securityToken, cashToken, registry, compliance;
  let admin, operator, pauser, agent, seller, buyer, outsider;

  const SECURITY_AMOUNT = ethers.parseUnits("100", 18);
  const CASH_AMOUNT     = ethers.parseUnits("5000", 6);  // 5,000 tokenized HKD
  const MATCH_ID        = ethers.keccak256(ethers.toUtf8Bytes("MATCH_001"));

  async function getDeadline(offsetSeconds = 3600) {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + offsetSeconds;
  }

  beforeEach(async function () {
    [admin, operator, pauser, agent, seller, buyer, outsider] = await ethers.getSigners();

    // Deploy Identity Registry
    const IdentityRegistry = await ethers.getContractFactory("HKSTPIdentityRegistry");
    registry = await IdentityRegistry.deploy(admin.address);

    // Deploy Compliance
    const Compliance = await ethers.getContractFactory("HKSTPCompliance");
    compliance = await Compliance.deploy(admin.address, admin.address);

    // Deploy Security Token
    const Token = await ethers.getContractFactory("HKSTPSecurityToken");
    securityToken = await Token.deploy(
      "HKSTP Alpha Token", "HKSAT",
      await registry.getAddress(),
      await compliance.getAddress(),
      ethers.ZeroAddress,
      admin.address
    );

    // Deploy Cash Token (tokenized HKD, 6 decimals)
    const MockCash = await ethers.getContractFactory("MockCashToken");
    cashToken = await MockCash.deploy("Tokenized HKD", "THKD", 6, admin.address);

    // Deploy DvP Settlement
    const DvP = await ethers.getContractFactory("DvPSettlement");
    dvp = await DvP.deploy(admin.address);

    // Grant additional roles
    const OPERATOR_ROLE = await dvp.OPERATOR_ROLE();
    const PAUSER_ROLE   = await dvp.PAUSER_ROLE();
    await dvp.connect(admin).grantRole(OPERATOR_ROLE, operator.address);
    await dvp.connect(admin).grantRole(PAUSER_ROLE,   pauser.address);

    // Grant AGENT_ROLE on token and registry to admin
    const TOKEN_AGENT    = await securityToken.AGENT_ROLE();
    const REGISTRY_AGENT = await registry.AGENT_ROLE();
    await securityToken.connect(admin).grantRole(TOKEN_AGENT,    agent.address);
    await registry.connect(admin).grantRole(REGISTRY_AGENT, agent.address);

    // Grant TOKEN_ROLE on compliance to the security token
    const TOKEN_ROLE = await compliance.TOKEN_ROLE();
    await compliance.connect(admin).grantRole(TOKEN_ROLE, await securityToken.getAddress());

    // Register and verify seller and buyer in identity registry
    async function registerAndVerify(addr) {
      await registry.connect(agent).registerIdentity(addr, ethers.ZeroAddress, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(addr, topic, true);
      }
    }
    await registerAndVerify(seller.address);
    await registerAndVerify(buyer.address);

    // Mint security tokens to seller
    await securityToken.connect(agent).mint(seller.address, SECURITY_AMOUNT);

    // Mint cash tokens to buyer
    await cashToken.connect(admin).mint(buyer.address, CASH_AMOUNT);

    // Seller approves DvP contract for security tokens
    await securityToken.connect(seller).approve(await dvp.getAddress(), SECURITY_AMOUNT);

    // Buyer approves DvP contract for cash tokens
    await cashToken.connect(buyer).approve(await dvp.getAddress(), CASH_AMOUNT);
  });

  // ---------------------------------------------------------------------------
  // Settlement creation
  // ---------------------------------------------------------------------------

  describe("createSettlement", function () {
    it("should create a settlement and emit SettlementCreated", async function () {
      const deadline = await getDeadline();
      const tx = await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), SECURITY_AMOUNT,
        await cashToken.getAddress(),     CASH_AMOUNT,
        deadline, MATCH_ID
      );

      const receipt = await tx.wait();
      await expect(tx).to.emit(dvp, "SettlementCreated");

      const s = await dvp.getSettlement(0);
      expect(s.seller).to.equal(seller.address);
      expect(s.buyer).to.equal(buyer.address);
      expect(s.status).to.equal(0); // Pending
    });

    it("should increment settlementCount", async function () {
      const deadline = await getDeadline();
      expect(await dvp.settlementCount()).to.equal(0);
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), SECURITY_AMOUNT,
        await cashToken.getAddress(),     CASH_AMOUNT,
        deadline, MATCH_ID
      );
      expect(await dvp.settlementCount()).to.equal(1);
    });

    it("should reject creation by non-operator", async function () {
      const deadline = await getDeadline();
      await expect(
        dvp.connect(outsider).createSettlement(
          seller.address, buyer.address,
          await securityToken.getAddress(), SECURITY_AMOUNT,
          await cashToken.getAddress(),     CASH_AMOUNT,
          deadline, MATCH_ID
        )
      ).to.be.reverted;
    });

    it("should reject deadline in the past", async function () {
      const block = await ethers.provider.getBlock("latest");
      await expect(
        dvp.connect(operator).createSettlement(
          seller.address, buyer.address,
          await securityToken.getAddress(), SECURITY_AMOUNT,
          await cashToken.getAddress(),     CASH_AMOUNT,
          block.timestamp - 1, // past deadline
          MATCH_ID
        )
      ).to.be.revertedWith("DvPSettlement: deadline in past");
    });

    it("should reject zero token amount", async function () {
      const deadline = await getDeadline();
      await expect(
        dvp.connect(operator).createSettlement(
          seller.address, buyer.address,
          await securityToken.getAddress(), 0n,
          await cashToken.getAddress(),     CASH_AMOUNT,
          deadline, MATCH_ID
        )
      ).to.be.revertedWith("DvPSettlement: zero token amount");
    });
  });

  // ---------------------------------------------------------------------------
  // executeSettlement
  // ---------------------------------------------------------------------------

  describe("executeSettlement", function () {
    let settlementId;

    beforeEach(async function () {
      const deadline = await getDeadline();
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), SECURITY_AMOUNT,
        await cashToken.getAddress(),     CASH_AMOUNT,
        deadline, MATCH_ID
      );
      settlementId = 0;
    });

    it("should execute atomically — both legs complete", async function () {
      const sellerCashBefore   = await cashToken.balanceOf(seller.address);
      const buyerSecBefore     = await securityToken.balanceOf(buyer.address);

      await dvp.connect(operator).executeSettlement(settlementId);

      expect(await securityToken.balanceOf(seller.address)).to.equal(0n);
      expect(await securityToken.balanceOf(buyer.address)).to.equal(SECURITY_AMOUNT);
      expect(await cashToken.balanceOf(buyer.address)).to.equal(0n);
      expect(await cashToken.balanceOf(seller.address)).to.equal(CASH_AMOUNT);

      const s = await dvp.getSettlement(settlementId);
      expect(s.status).to.equal(1); // Settled
    });

    it("should emit SettlementExecuted", async function () {
      await expect(dvp.connect(operator).executeSettlement(settlementId))
        .to.emit(dvp, "SettlementExecuted");
    });

    it("should reject execution by non-operator", async function () {
      await expect(
        dvp.connect(outsider).executeSettlement(settlementId)
      ).to.be.reverted;
    });

    it("should reject executing the same settlement twice", async function () {
      await dvp.connect(operator).executeSettlement(settlementId);
      await expect(
        dvp.connect(operator).executeSettlement(settlementId)
      ).to.be.revertedWith("DvPSettlement: not pending");
    });

    it("should revert when security token transfer fails (seller has no tokens)", async function () {
      // Transfer seller's security tokens away to cause insufficient balance
      await securityToken.connect(seller).transfer(buyer.address, SECURITY_AMOUNT);
      await expect(
        dvp.connect(operator).executeSettlement(settlementId)
      ).to.be.reverted;
    });

    it("should revert when cash token transfer fails (buyer has no cash)", async function () {
      // Transfer buyer's cash tokens away
      await cashToken.connect(buyer).transfer(seller.address, CASH_AMOUNT);
      await expect(
        dvp.connect(operator).executeSettlement(settlementId)
      ).to.be.reverted;
    });

    it("should revert when past the settlement deadline", async function () {
      // Create a settlement with very short deadline
      const block = await ethers.provider.getBlock("latest");
      const shortDeadline = block.timestamp + 2;
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), 1n,
        await cashToken.getAddress(),     1n,
        shortDeadline, ethers.keccak256(ethers.toUtf8Bytes("MATCH_002"))
      );
      const shortId = 1;

      // Advance time past deadline
      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      await expect(
        dvp.connect(operator).executeSettlement(shortId)
      ).to.be.revertedWith("DvPSettlement: deadline passed");
    });

    it("should revert when compliance check blocks security token transfer", async function () {
      // Remove buyer's KYC claim → security token transfer will fail compliance
      const REGISTRY_AGENT = await registry.AGENT_ROLE();
      await registry.connect(admin).grantRole(REGISTRY_AGENT, admin.address);
      await registry.connect(admin).setClaim(buyer.address, 1, false);

      await expect(
        dvp.connect(operator).executeSettlement(settlementId)
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Pause
  // ---------------------------------------------------------------------------

  describe("Pause", function () {
    it("should block settlement creation when paused", async function () {
      await dvp.connect(pauser).pause();
      const deadline = await getDeadline();
      await expect(
        dvp.connect(operator).createSettlement(
          seller.address, buyer.address,
          await securityToken.getAddress(), SECURITY_AMOUNT,
          await cashToken.getAddress(),     CASH_AMOUNT,
          deadline, MATCH_ID
        )
      ).to.be.reverted;
    });

    it("should block settlement execution when paused", async function () {
      const deadline = await getDeadline();
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), SECURITY_AMOUNT,
        await cashToken.getAddress(),     CASH_AMOUNT,
        deadline, MATCH_ID
      );

      await dvp.connect(pauser).pause();
      await expect(
        dvp.connect(operator).executeSettlement(0)
      ).to.be.reverted;
    });

    it("should allow execution after unpause", async function () {
      const deadline = await getDeadline();
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), SECURITY_AMOUNT,
        await cashToken.getAddress(),     CASH_AMOUNT,
        deadline, MATCH_ID
      );

      await dvp.connect(pauser).pause();
      await dvp.connect(pauser).unpause();
      await dvp.connect(operator).executeSettlement(0);

      const s = await dvp.getSettlement(0);
      expect(s.status).to.equal(1); // Settled
    });
  });

  // ---------------------------------------------------------------------------
  // Cancellation and markFailed
  // ---------------------------------------------------------------------------

  describe("Cancellation and markFailed", function () {
    let id;

    beforeEach(async function () {
      const deadline = await getDeadline();
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), SECURITY_AMOUNT,
        await cashToken.getAddress(),     CASH_AMOUNT,
        deadline, MATCH_ID
      );
      id = 0;
    });

    it("should allow operator to cancel a pending settlement", async function () {
      await expect(dvp.connect(operator).cancelSettlement(id))
        .to.emit(dvp, "SettlementCancelled");

      const s = await dvp.getSettlement(id);
      expect(s.status).to.equal(3); // Cancelled
    });

    it("should allow anyone to mark expired settlement as failed", async function () {
      // Create a settlement with a very short deadline
      const block = await ethers.provider.getBlock("latest");
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), 1n,
        await cashToken.getAddress(),     1n,
        block.timestamp + 2,
        ethers.keccak256(ethers.toUtf8Bytes("MATCH_003"))
      );
      const expiredId = 1;

      await ethers.provider.send("evm_increaseTime", [10]);
      await ethers.provider.send("evm_mine");

      await expect(dvp.connect(outsider).markFailed(expiredId))
        .to.emit(dvp, "SettlementFailed");

      const s = await dvp.getSettlement(expiredId);
      expect(s.status).to.equal(2); // Failed
    });

    it("should reject markFailed before deadline has passed", async function () {
      await expect(dvp.connect(outsider).markFailed(id))
        .to.be.revertedWith("DvPSettlement: deadline not passed");
    });

    it("should reject cancellation by non-operator", async function () {
      await expect(dvp.connect(outsider).cancelSettlement(id))
        .to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // FATF Recommendation 16 — Travel Rule
  // ---------------------------------------------------------------------------

  describe("Travel Rule (FATF Rec. 16)", function () {
    let id;
    const ORIGINATOR_VASP   = ethers.id("VASP-HK-001");
    const BENEFICIARY_VASP  = ethers.id("VASP-HK-002");
    const ORIGINATOR_INFO   = ethers.id("originator:John Doe:ACC-123");
    const BENEFICIARY_INFO  = ethers.id("beneficiary:Jane Smith:ACC-456");

    beforeEach(async function () {
      const deadline = await getDeadline(3600);
      const tx = await dvp.connect(operator).createSettlement(
        seller.address, buyer.address,
        await securityToken.getAddress(), SECURITY_AMOUNT,
        await cashToken.getAddress(),     CASH_AMOUNT,
        deadline, MATCH_ID
      );
      id = 0;
    });

    it("should record travel rule data for a settlement", async function () {
      await dvp.connect(operator).setTravelRuleData(
        id, ORIGINATOR_VASP, BENEFICIARY_VASP, ORIGINATOR_INFO, BENEFICIARY_INFO
      );
      expect(await dvp.hasTravelRuleData(id)).to.be.true;
    });

    it("should emit TravelRuleDataRecorded event", async function () {
      await expect(
        dvp.connect(operator).setTravelRuleData(
          id, ORIGINATOR_VASP, BENEFICIARY_VASP, ORIGINATOR_INFO, BENEFICIARY_INFO
        )
      ).to.emit(dvp, "TravelRuleDataRecorded");
    });

    it("should store and return correct travel rule data", async function () {
      await dvp.connect(operator).setTravelRuleData(
        id, ORIGINATOR_VASP, BENEFICIARY_VASP, ORIGINATOR_INFO, BENEFICIARY_INFO
      );
      const data = await dvp.getTravelRuleData(id);
      expect(data.originatorVASP).to.equal(ORIGINATOR_VASP);
      expect(data.beneficiaryVASP).to.equal(BENEFICIARY_VASP);
      expect(data.originatorInfoHash).to.equal(ORIGINATOR_INFO);
      expect(data.beneficiaryInfoHash).to.equal(BENEFICIARY_INFO);
      expect(data.timestamp).to.be.gt(0);
    });

    it("should revert getTravelRuleData when no data set", async function () {
      await expect(dvp.getTravelRuleData(id))
        .to.be.revertedWith("DvPSettlement: no travel rule data");
    });

    it("should revert with zero originator VASP", async function () {
      await expect(
        dvp.connect(operator).setTravelRuleData(
          id, ethers.ZeroHash, BENEFICIARY_VASP, ORIGINATOR_INFO, BENEFICIARY_INFO
        )
      ).to.be.revertedWith("DvPSettlement: zero originator VASP");
    });

    it("should revert with zero beneficiary VASP", async function () {
      await expect(
        dvp.connect(operator).setTravelRuleData(
          id, ORIGINATOR_VASP, ethers.ZeroHash, ORIGINATOR_INFO, BENEFICIARY_INFO
        )
      ).to.be.revertedWith("DvPSettlement: zero beneficiary VASP");
    });

    it("should revert with zero originator info", async function () {
      await expect(
        dvp.connect(operator).setTravelRuleData(
          id, ORIGINATOR_VASP, BENEFICIARY_VASP, ethers.ZeroHash, BENEFICIARY_INFO
        )
      ).to.be.revertedWith("DvPSettlement: zero originator info");
    });

    it("should revert with zero beneficiary info", async function () {
      await expect(
        dvp.connect(operator).setTravelRuleData(
          id, ORIGINATOR_VASP, BENEFICIARY_VASP, ORIGINATOR_INFO, ethers.ZeroHash
        )
      ).to.be.revertedWith("DvPSettlement: zero beneficiary info");
    });

    it("should revert when called by non-operator", async function () {
      await expect(
        dvp.connect(outsider).setTravelRuleData(
          id, ORIGINATOR_VASP, BENEFICIARY_VASP, ORIGINATOR_INFO, BENEFICIARY_INFO
        )
      ).to.be.reverted;
    });

    it("should revert for invalid settlement ID", async function () {
      await expect(
        dvp.connect(operator).setTravelRuleData(
          999, ORIGINATOR_VASP, BENEFICIARY_VASP, ORIGINATOR_INFO, BENEFICIARY_INFO
        )
      ).to.be.revertedWith("DvPSettlement: invalid settlement ID");
    });

    it("should revert when settlement is not pending", async function () {
      // Execute the settlement first
      await dvp.connect(operator).executeSettlement(id);
      await expect(
        dvp.connect(operator).setTravelRuleData(
          id, ORIGINATOR_VASP, BENEFICIARY_VASP, ORIGINATOR_INFO, BENEFICIARY_INFO
        )
      ).to.be.revertedWith("DvPSettlement: not pending");
    });
  });
});
