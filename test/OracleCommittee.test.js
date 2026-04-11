const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title OracleCommittee test suite
 *
 * Tests cover:
 *   - Constructor validation (threshold, member count)
 *   - Multi-oracle attestation verification (2-of-3)
 *   - Replay protection
 *   - Expired attestation rejection
 *   - Duplicate signer rejection
 *   - Non-oracle signer rejection
 *   - consumeMultiAttestation marks as used
 *   - Oracle member add/remove
 *   - Threshold management
 */
describe("OracleCommittee", function () {
  let committee;
  let admin, oracle1, oracle2, oracle3, alice, bob, outsider;

  const DOMAIN_NAME    = "HKSTPCompliance";
  const DOMAIN_VERSION = "1";

  const ATTESTATION_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
      "Attestation(address from,address to,uint256 amount,uint256 expiry,uint256 nonce)"
    )
  );

  beforeEach(async function () {
    [admin, oracle1, oracle2, oracle3, alice, bob, outsider] = await ethers.getSigners();

    const OracleCommittee = await ethers.getContractFactory("OracleCommittee");
    committee = await OracleCommittee.deploy(
      admin.address,
      [oracle1.address, oracle2.address, oracle3.address],
      2 // threshold
    );
  });

  // ── Helpers ─────────────────────────────────────────────────────

  async function signAttestation(from, to, amount, expiry, nonce, signer) {
    const domain = {
      name:              DOMAIN_NAME,
      version:           DOMAIN_VERSION,
      chainId:           (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await committee.getAddress(),
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
    const value = { from, to, amount, expiry, nonce };
    return signer.signTypedData(domain, types, value);
  }

  async function futureTimestamp(offset = 3600) {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + offset;
  }

  // ── Constructor ───────────────────────────────────────────────

  describe("Constructor", function () {
    it("should set the correct threshold", async function () {
      expect(await committee.threshold()).to.equal(2);
    });

    it("should register 3 oracle members", async function () {
      expect(await committee.oracleCount()).to.equal(3);
      const members = await committee.oracleMembers();
      expect(members).to.include(oracle1.address);
      expect(members).to.include(oracle2.address);
      expect(members).to.include(oracle3.address);
    });

    it("should grant ORACLE_ROLE to each member", async function () {
      const ORACLE_ROLE = await committee.ORACLE_ROLE();
      expect(await committee.hasRole(ORACLE_ROLE, oracle1.address)).to.be.true;
      expect(await committee.hasRole(ORACLE_ROLE, oracle2.address)).to.be.true;
      expect(await committee.hasRole(ORACLE_ROLE, oracle3.address)).to.be.true;
    });

    it("should revert with fewer than 2 oracles", async function () {
      const OC = await ethers.getContractFactory("OracleCommittee");
      await expect(
        OC.deploy(admin.address, [oracle1.address], 1)
      ).to.be.revertedWith("OracleCommittee: need >=2 oracles");
    });

    it("should revert with threshold < 2", async function () {
      const OC = await ethers.getContractFactory("OracleCommittee");
      await expect(
        OC.deploy(admin.address, [oracle1.address, oracle2.address], 1)
      ).to.be.revertedWith("OracleCommittee: threshold must be >=2");
    });

    it("should revert with threshold > member count", async function () {
      const OC = await ethers.getContractFactory("OracleCommittee");
      await expect(
        OC.deploy(admin.address, [oracle1.address, oracle2.address], 3)
      ).to.be.revertedWith("OracleCommittee: threshold > members");
    });

    it("should revert with zero admin", async function () {
      const OC = await ethers.getContractFactory("OracleCommittee");
      await expect(
        OC.deploy(ethers.ZeroAddress, [oracle1.address, oracle2.address], 2)
      ).to.be.revertedWith("OracleCommittee: zero admin");
    });
  });

  // ── verifyMultiAttestation ────────────────────────────────────

  describe("verifyMultiAttestation", function () {
    it("should return true with 2 valid oracle signatures (2-of-3)", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 1, oracle1);
      const sig2 = await signAttestation(alice.address, bob.address, 1000, expiry, 1, oracle2);

      const result = await committee.verifyMultiAttestation(
        alice.address, bob.address, 1000, expiry, 1, [sig1, sig2]
      );
      expect(result).to.be.true;
    });

    it("should return true with 3 valid oracle signatures", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 2, oracle1);
      const sig2 = await signAttestation(alice.address, bob.address, 1000, expiry, 2, oracle2);
      const sig3 = await signAttestation(alice.address, bob.address, 1000, expiry, 2, oracle3);

      const result = await committee.verifyMultiAttestation(
        alice.address, bob.address, 1000, expiry, 2, [sig1, sig2, sig3]
      );
      expect(result).to.be.true;
    });

    it("should return false for expired attestation", async function () {
      const block = await ethers.provider.getBlock("latest");
      const pastExpiry = block.timestamp - 100;

      const sig1 = await signAttestation(alice.address, bob.address, 1000, pastExpiry, 3, oracle1);
      const sig2 = await signAttestation(alice.address, bob.address, 1000, pastExpiry, 3, oracle2);

      const result = await committee.verifyMultiAttestation(
        alice.address, bob.address, 1000, pastExpiry, 3, [sig1, sig2]
      );
      expect(result).to.be.false;
    });

    it("should return false when non-oracle signs", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 4, oracle1);
      const sigBad = await signAttestation(alice.address, bob.address, 1000, expiry, 4, outsider);

      const result = await committee.verifyMultiAttestation(
        alice.address, bob.address, 1000, expiry, 4, [sig1, sigBad]
      );
      expect(result).to.be.false;
    });

    it("should return false when same oracle signs twice (duplicate)", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 5, oracle1);

      const result = await committee.verifyMultiAttestation(
        alice.address, bob.address, 1000, expiry, 5, [sig1, sig1]
      );
      expect(result).to.be.false;
    });

    it("should revert with fewer signatures than threshold", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 6, oracle1);

      await expect(
        committee.verifyMultiAttestation(alice.address, bob.address, 1000, expiry, 6, [sig1])
      ).to.be.revertedWith("OracleCommittee: not enough sigs");
    });
  });

  // ── consumeMultiAttestation ───────────────────────────────────

  describe("consumeMultiAttestation", function () {
    it("should succeed and mark attestation as used", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 10, oracle1);
      const sig2 = await signAttestation(alice.address, bob.address, 1000, expiry, 10, oracle2);

      await expect(
        committee.consumeMultiAttestation(alice.address, bob.address, 1000, expiry, 10, [sig1, sig2])
      ).to.emit(committee, "MultiAttestationConsumed");
    });

    it("should revert on replay (second consume)", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 11, oracle1);
      const sig2 = await signAttestation(alice.address, bob.address, 1000, expiry, 11, oracle2);

      await committee.consumeMultiAttestation(alice.address, bob.address, 1000, expiry, 11, [sig1, sig2]);

      await expect(
        committee.consumeMultiAttestation(alice.address, bob.address, 1000, expiry, 11, [sig1, sig2])
      ).to.be.revertedWith("OracleCommittee: attestation already used");
    });

    it("should revert for expired attestation", async function () {
      const block = await ethers.provider.getBlock("latest");
      const pastExpiry = block.timestamp - 100;

      const sig1 = await signAttestation(alice.address, bob.address, 1000, pastExpiry, 12, oracle1);
      const sig2 = await signAttestation(alice.address, bob.address, 1000, pastExpiry, 12, oracle2);

      await expect(
        committee.consumeMultiAttestation(alice.address, bob.address, 1000, pastExpiry, 12, [sig1, sig2])
      ).to.be.revertedWith("OracleCommittee: attestation expired");
    });

    it("should revert with insufficient valid signatures", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 13, oracle1);
      const sigBad = await signAttestation(alice.address, bob.address, 1000, expiry, 13, outsider);

      await expect(
        committee.consumeMultiAttestation(alice.address, bob.address, 1000, expiry, 13, [sig1, sigBad])
      ).to.be.revertedWith("OracleCommittee: insufficient valid signatures");
    });

    it("verify returns false after attestation is consumed", async function () {
      const expiry = await futureTimestamp();
      const sig1 = await signAttestation(alice.address, bob.address, 1000, expiry, 14, oracle1);
      const sig2 = await signAttestation(alice.address, bob.address, 1000, expiry, 14, oracle2);

      await committee.consumeMultiAttestation(alice.address, bob.address, 1000, expiry, 14, [sig1, sig2]);

      const result = await committee.verifyMultiAttestation(
        alice.address, bob.address, 1000, expiry, 14, [sig1, sig2]
      );
      expect(result).to.be.false;
    });
  });

  // ── Oracle management ─────────────────────────────────────────

  describe("Oracle management", function () {
    it("should add a new oracle member", async function () {
      await expect(committee.connect(admin).addOracle(outsider.address))
        .to.emit(committee, "OracleMemberAdded")
        .withArgs(outsider.address);

      expect(await committee.oracleCount()).to.equal(4);
    });

    it("should reject adding existing oracle", async function () {
      await expect(
        committee.connect(admin).addOracle(oracle1.address)
      ).to.be.revertedWith("OracleCommittee: already oracle");
    });

    it("should reject adding zero address", async function () {
      await expect(
        committee.connect(admin).addOracle(ethers.ZeroAddress)
      ).to.be.revertedWith("OracleCommittee: zero address");
    });

    it("should reject add from non-admin", async function () {
      await expect(
        committee.connect(outsider).addOracle(outsider.address)
      ).to.be.reverted;
    });

    it("should remove an oracle member", async function () {
      await expect(committee.connect(admin).removeOracle(oracle3.address))
        .to.emit(committee, "OracleMemberRemoved")
        .withArgs(oracle3.address);

      expect(await committee.oracleCount()).to.equal(2);
    });

    it("should reject removing oracle below threshold", async function () {
      // Remove one first (3->2), now removing another would go 2->1 which is below threshold=2
      await committee.connect(admin).removeOracle(oracle3.address);
      await expect(
        committee.connect(admin).removeOracle(oracle2.address)
      ).to.be.revertedWith("OracleCommittee: would go below threshold");
    });

    it("should reject removing non-oracle", async function () {
      await expect(
        committee.connect(admin).removeOracle(outsider.address)
      ).to.be.revertedWith("OracleCommittee: not oracle");
    });
  });

  // ── Threshold management ──────────────────────────────────────

  describe("Threshold management", function () {
    it("should update threshold", async function () {
      await expect(committee.connect(admin).setThreshold(3))
        .to.emit(committee, "ThresholdUpdated")
        .withArgs(2, 3);

      expect(await committee.threshold()).to.equal(3);
    });

    it("should reject threshold < 2", async function () {
      await expect(
        committee.connect(admin).setThreshold(1)
      ).to.be.revertedWith("OracleCommittee: threshold must be >=2");
    });

    it("should reject threshold > member count", async function () {
      await expect(
        committee.connect(admin).setThreshold(4)
      ).to.be.revertedWith("OracleCommittee: threshold > members");
    });

    it("should reject threshold update from non-admin", async function () {
      await expect(
        committee.connect(outsider).setThreshold(3)
      ).to.be.reverted;
    });
  });

  // ── Domain separator ──────────────────────────────────────────

  describe("Domain separator", function () {
    it("should expose the EIP-712 domain separator", async function () {
      const sep = await committee.domainSeparator();
      expect(sep).to.not.equal(ethers.ZeroHash);
    });
  });
});
