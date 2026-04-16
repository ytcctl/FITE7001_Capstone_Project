const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title AML / Travel Rule / Risk-Based Approach test suite
 *
 * Tests cover:
 *   - COMPLIANCE_OFFICER_ROLE and MLRO_ROLE separation of duties
 *   - Suspicious Transaction Report (STR) filing on-chain (AMLO s.25A)
 *   - CDD record anchoring with 5-year retention timestamp (AMLO s.22)
 *   - FPS name-match claim topic (CLAIM_FPS_NAME_MATCH = 6)
 *   - Role-based access control for AML operations
 */
describe("AML / Travel Rule / Risk-Based Approach", function () {
  let registry;
  let admin, agent, co, mlro, alice, bob, outsider;

  const CDD_HASH    = ethers.id("cdd-bundle:passport+address-proof+bank-stmt");
  const REPORT_HASH = ethers.id("STR-JFIU-2026-0042");

  beforeEach(async function () {
    [admin, agent, co, mlro, alice, bob, outsider] = await ethers.getSigners();

    // Deploy Identity Registry
    const IdentityRegistry = await ethers.getContractFactory("HKSTPIdentityRegistry");
    registry = await IdentityRegistry.deploy(admin.address);

    // Grant specific roles
    const AGENT_ROLE = await registry.AGENT_ROLE();
    const CO_ROLE    = await registry.COMPLIANCE_OFFICER_ROLE();
    const MLRO_ROLE  = await registry.MLRO_ROLE();

    await registry.connect(admin).grantRole(AGENT_ROLE, agent.address);
    await registry.connect(admin).grantRole(CO_ROLE,    co.address);
    await registry.connect(admin).grantRole(MLRO_ROLE,  mlro.address);

    // Register alice as an investor
    await registry.connect(agent).registerIdentity(alice.address, ethers.ZeroAddress, "HK");
    for (let topic = 1; topic <= 5; topic++) {
      await registry.connect(agent).setClaim(alice.address, topic, true);
    }
  });

  // ---------------------------------------------------------------------------
  // Role Separation (SFC Code of Conduct 12.4)
  // ---------------------------------------------------------------------------

  describe("Role Separation", function () {
    it("should expose COMPLIANCE_OFFICER_ROLE constant", async function () {
      const role = await registry.COMPLIANCE_OFFICER_ROLE();
      expect(role).to.equal(ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_OFFICER_ROLE")));
    });

    it("should expose MLRO_ROLE constant", async function () {
      const role = await registry.MLRO_ROLE();
      expect(role).to.equal(ethers.keccak256(ethers.toUtf8Bytes("MLRO_ROLE")));
    });

    it("should grant CO and MLRO roles to admin by default", async function () {
      const CO_ROLE   = await registry.COMPLIANCE_OFFICER_ROLE();
      const MLRO_R    = await registry.MLRO_ROLE();
      expect(await registry.hasRole(CO_ROLE, admin.address)).to.be.true;
      expect(await registry.hasRole(MLRO_R, admin.address)).to.be.true;
    });

    it("CO should NOT be able to file STR (MLRO-only)", async function () {
      await expect(
        registry.connect(co).reportSuspiciousActivity(alice.address, REPORT_HASH)
      ).to.be.reverted;
    });

    it("MLRO should NOT be able to anchor CDD records (CO-only)", async function () {
      await expect(
        registry.connect(mlro).anchorCDDRecord(alice.address, CDD_HASH, 5)
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Suspicious Transaction Reporting (AMLO s.25A)
  // ---------------------------------------------------------------------------

  describe("Suspicious Transaction Reporting", function () {
    it("MLRO should file an STR and emit SuspiciousActivityReported", async function () {
      await expect(
        registry.connect(mlro).reportSuspiciousActivity(alice.address, REPORT_HASH)
      ).to.emit(registry, "SuspiciousActivityReported")
        .withArgs(alice.address, mlro.address, REPORT_HASH, await getTimestamp());
    });

    it("should store STR record with correct fields", async function () {
      await registry.connect(mlro).reportSuspiciousActivity(alice.address, REPORT_HASH);
      const records = await registry.getSTRRecords(alice.address);
      expect(records.length).to.equal(1);
      expect(records[0].reportHash).to.equal(REPORT_HASH);
      expect(records[0].reporter).to.equal(mlro.address);
      expect(records[0].timestamp).to.be.gt(0);
    });

    it("should accumulate multiple STR records", async function () {
      const hash2 = ethers.id("STR-JFIU-2026-0043");
      await registry.connect(mlro).reportSuspiciousActivity(alice.address, REPORT_HASH);
      await registry.connect(mlro).reportSuspiciousActivity(alice.address, hash2);
      expect(await registry.getSTRCount(alice.address)).to.equal(2);
    });

    it("should revert STR with zero address", async function () {
      await expect(
        registry.connect(mlro).reportSuspiciousActivity(ethers.ZeroAddress, REPORT_HASH)
      ).to.be.revertedWith("HKSTPIdentityRegistry: zero address");
    });

    it("should revert STR with zero report hash", async function () {
      await expect(
        registry.connect(mlro).reportSuspiciousActivity(alice.address, ethers.ZeroHash)
      ).to.be.revertedWith("HKSTPIdentityRegistry: zero report hash");
    });

    it("should revert STR from non-MLRO", async function () {
      await expect(
        registry.connect(outsider).reportSuspiciousActivity(alice.address, REPORT_HASH)
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // CDD Record Anchoring (AMLO s.22 — 5-year retention)
  // ---------------------------------------------------------------------------

  describe("CDD Record Anchoring", function () {
    it("CO should anchor a CDD record and emit CDDRecordAnchored", async function () {
      await expect(
        registry.connect(co).anchorCDDRecord(alice.address, CDD_HASH, 7)
      ).to.emit(registry, "CDDRecordAnchored");
    });

    it("should store CDD record with correct retention expiry", async function () {
      await registry.connect(co).anchorCDDRecord(alice.address, CDD_HASH, 5);
      const records = await registry.getCDDRecords(alice.address);
      expect(records.length).to.equal(1);
      expect(records[0].cddHash).to.equal(CDD_HASH);
      expect(records[0].issuedAt).to.be.gt(0);
      // retentionExpiry ≈ issuedAt + 5 * 365 days
      const fiveYears = 5n * 365n * 24n * 60n * 60n;
      expect(records[0].retentionExpiry).to.equal(records[0].issuedAt + fiveYears);
    });

    it("should return true for hasCDDInRetention when record is fresh", async function () {
      await registry.connect(co).anchorCDDRecord(alice.address, CDD_HASH, 5);
      expect(await registry.hasCDDInRetention(alice.address)).to.be.true;
    });

    it("should return false for hasCDDInRetention when no records exist", async function () {
      expect(await registry.hasCDDInRetention(bob.address)).to.be.false;
    });

    it("should revert CDD anchoring for unregistered investor", async function () {
      await expect(
        registry.connect(co).anchorCDDRecord(bob.address, CDD_HASH, 5)
      ).to.be.revertedWith("HKSTPIdentityRegistry: not registered");
    });

    it("should revert CDD with zero hash", async function () {
      await expect(
        registry.connect(co).anchorCDDRecord(alice.address, ethers.ZeroHash, 5)
      ).to.be.revertedWith("HKSTPIdentityRegistry: zero CDD hash");
    });

    it("should revert CDD with retention < 5 years", async function () {
      await expect(
        registry.connect(co).anchorCDDRecord(alice.address, CDD_HASH, 4)
      ).to.be.revertedWith("HKSTPIdentityRegistry: retention < 5 years");
    });

    it("should revert CDD from non-CO", async function () {
      await expect(
        registry.connect(outsider).anchorCDDRecord(alice.address, CDD_HASH, 5)
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // FPS Name-Match Claim (Topic 6)
  // ---------------------------------------------------------------------------

  describe("FPS Name-Match Claim (Topic 6)", function () {
    it("should expose CLAIM_FPS_NAME_MATCH constant = 6", async function () {
      expect(await registry.CLAIM_FPS_NAME_MATCH()).to.equal(6);
    });

    it("agent should set FPS name-match claim", async function () {
      const CLAIM_FPS = await registry.CLAIM_FPS_NAME_MATCH();
      await registry.connect(agent).setClaim(alice.address, CLAIM_FPS, true);
      expect(await registry.hasClaim(alice.address, CLAIM_FPS)).to.be.true;
    });

    it("agent should revoke FPS name-match claim", async function () {
      const CLAIM_FPS = await registry.CLAIM_FPS_NAME_MATCH();
      await registry.connect(agent).setClaim(alice.address, CLAIM_FPS, true);
      await registry.connect(agent).setClaim(alice.address, CLAIM_FPS, false);
      expect(await registry.hasClaim(alice.address, CLAIM_FPS)).to.be.false;
    });

    it("should emit ClaimSet event for FPS claim", async function () {
      const CLAIM_FPS = await registry.CLAIM_FPS_NAME_MATCH();
      await expect(
        registry.connect(agent).setClaim(alice.address, CLAIM_FPS, true)
      ).to.emit(registry, "ClaimSet")
        .withArgs(alice.address, CLAIM_FPS, true);
    });
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function getTimestamp() {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + 1; // next block
  }
});
