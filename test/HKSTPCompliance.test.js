const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title HKSTPCompliance test suite
 *
 * Tests cover:
 *   - Attestation signature verification
 *   - Expired attestation rejection
 *   - Replay protection (nonce / used attestation)
 *   - Invalid signer rejection
 *   - Module checks (jurisdiction, lock-up, concentration cap)
 */
describe("HKSTPCompliance", function () {
  let compliance;
  let admin, oracle, tokenRole, alice, bob, attacker;

  // EIP-712 domain separator for compliance contract
  const DOMAIN_NAME    = "HKSTPCompliance";
  const DOMAIN_VERSION = "1";

  const ATTESTATION_TYPEHASH = ethers.keccak256(
    ethers.toUtf8Bytes(
      "Attestation(address from,address to,uint256 amount,uint256 expiry,uint256 nonce)"
    )
  );

  beforeEach(async function () {
    [admin, oracle, tokenRole, alice, bob, attacker] = await ethers.getSigners();

    const Compliance = await ethers.getContractFactory("HKSTPCompliance");
    compliance = await Compliance.deploy(admin.address, oracle.address);

    // Grant TOKEN_ROLE to tokenRole account so it can call consumeAttestation
    const TOKEN_ROLE = await compliance.TOKEN_ROLE();
    await compliance.connect(admin).grantRole(TOKEN_ROLE, tokenRole.address);
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function makeAttestation(from, to, amount, expiry, nonce, signer) {
    const domain = {
      name:              DOMAIN_NAME,
      version:           DOMAIN_VERSION,
      chainId:           (await ethers.provider.getNetwork()).chainId,
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
    const value = { from, to, amount, expiry, nonce };
    return signer.signTypedData(domain, types, value);
  }

  async function futureExpiry(secondsFromNow = 3600) {
    const block = await ethers.provider.getBlock("latest");
    return block.timestamp + secondsFromNow;
  }

  // ---------------------------------------------------------------------------
  // verifyAttestation
  // ---------------------------------------------------------------------------

  describe("verifyAttestation", function () {
    it("should return true for a valid oracle signature", async function () {
      const expiry  = await futureExpiry();
      const nonce   = 1;
      const amount  = ethers.parseUnits("100", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, oracle);

      expect(await compliance.verifyAttestation(
        alice.address, bob.address, amount, expiry, nonce, sig
      )).to.be.true;
    });

    it("should return false for an expired attestation", async function () {
      const block   = await ethers.provider.getBlock("latest");
      const expiry  = block.timestamp - 1; // already expired
      const nonce   = 2;
      const amount  = ethers.parseUnits("50", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, oracle);

      expect(await compliance.verifyAttestation(
        alice.address, bob.address, amount, expiry, nonce, sig
      )).to.be.false;
    });

    it("should return false for an invalid signer", async function () {
      const expiry  = await futureExpiry();
      const nonce   = 3;
      const amount  = ethers.parseUnits("100", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, attacker);

      expect(await compliance.verifyAttestation(
        alice.address, bob.address, amount, expiry, nonce, sig
      )).to.be.false;
    });

    it("should return false for a used attestation", async function () {
      const expiry  = await futureExpiry();
      const nonce   = 4;
      const amount  = ethers.parseUnits("100", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, oracle);

      // Consume the attestation
      await compliance.connect(tokenRole).consumeAttestation(
        alice.address, bob.address, amount, expiry, nonce, sig
      );

      // verifyAttestation should now return false (already used)
      expect(await compliance.verifyAttestation(
        alice.address, bob.address, amount, expiry, nonce, sig
      )).to.be.false;
    });
  });

  // ---------------------------------------------------------------------------
  // consumeAttestation
  // ---------------------------------------------------------------------------

  describe("consumeAttestation", function () {
    it("should succeed and mark the attestation as used", async function () {
      const expiry  = await futureExpiry();
      const nonce   = 10;
      const amount  = ethers.parseUnits("200", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, oracle);

      await expect(
        compliance.connect(tokenRole).consumeAttestation(
          alice.address, bob.address, amount, expiry, nonce, sig
        )
      ).to.emit(compliance, "AttestationConsumed");

      // usedAttestations mapping should now be true for this attestation hash
      const attestHash = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
          ["address","address","uint256","uint256","uint256"],
          [alice.address, bob.address, amount, expiry, nonce]
        )
      );
      expect(await compliance.usedAttestations(attestHash)).to.be.true;
    });

    it("should revert on replay (second consume of same attestation)", async function () {
      const expiry  = await futureExpiry();
      const nonce   = 11;
      const amount  = ethers.parseUnits("100", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, oracle);

      await compliance.connect(tokenRole).consumeAttestation(
        alice.address, bob.address, amount, expiry, nonce, sig
      );

      await expect(
        compliance.connect(tokenRole).consumeAttestation(
          alice.address, bob.address, amount, expiry, nonce, sig
        )
      ).to.be.revertedWith("HKSTPCompliance: attestation already used");
    });

    it("should revert for expired attestation", async function () {
      const block   = await ethers.provider.getBlock("latest");
      const expiry  = block.timestamp - 1;
      const nonce   = 12;
      const amount  = ethers.parseUnits("100", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, oracle);

      await expect(
        compliance.connect(tokenRole).consumeAttestation(
          alice.address, bob.address, amount, expiry, nonce, sig
        )
      ).to.be.revertedWith("HKSTPCompliance: attestation expired");
    });

    it("should revert for invalid signer", async function () {
      const expiry  = await futureExpiry();
      const nonce   = 13;
      const amount  = ethers.parseUnits("100", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, attacker);

      await expect(
        compliance.connect(tokenRole).consumeAttestation(
          alice.address, bob.address, amount, expiry, nonce, sig
        )
      ).to.be.revertedWith("HKSTPCompliance: invalid signer");
    });

    it("should revert when called without TOKEN_ROLE", async function () {
      const expiry  = await futureExpiry();
      const nonce   = 14;
      const amount  = ethers.parseUnits("100", 18);
      const sig     = await makeAttestation(alice.address, bob.address, amount, expiry, nonce, oracle);

      await expect(
        compliance.connect(attacker).consumeAttestation(
          alice.address, bob.address, amount, expiry, nonce, sig
        )
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Module checks
  // ---------------------------------------------------------------------------

  describe("checkModules", function () {
    const HK  = ethers.encodeBytes32String("HK").slice(0, 6); // bytes2 "HK"
    const toBytes2 = (s) => ethers.toUtf8Bytes(s).slice(0, 2);

    function toBytes2Hex(s) {
      // Convert 2-char string to bytes2 (left-padded)
      const bytes = ethers.toUtf8Bytes(s);
      return ethers.zeroPadValue(ethers.hexlify(bytes.slice(0, 2)), 2);
    }

    it("should pass when no caps, all jurisdictions allowed, no lock-up", async function () {
      const [ok, reason] = await compliance.checkModules(
        alice.address, bob.address,
        100n, 200n,
        toBytes2Hex("HK"), toBytes2Hex("HK")
      );
      expect(ok).to.be.true;
      expect(reason).to.equal("");
    });

    it("should block when sender is under lock-up", async function () {
      const block = await ethers.provider.getBlock("latest");
      await compliance.connect(admin).setLockUp(alice.address, block.timestamp + 3600);

      const [ok, reason] = await compliance.checkModules(
        alice.address, bob.address,
        100n, 200n,
        toBytes2Hex("HK"), toBytes2Hex("HK")
      );
      expect(ok).to.be.false;
      expect(reason).to.include("locked up");
    });

    it("should block when recipient jurisdiction is disallowed", async function () {
      await compliance.connect(admin).setJurisdiction(
        ethers.toUtf8Bytes("US").slice(0, 2), false
      );

      const [ok, reason] = await compliance.checkModules(
        alice.address, bob.address,
        100n, 200n,
        toBytes2Hex("HK"), toBytes2Hex("US")
      );
      expect(ok).to.be.false;
      expect(reason).to.include("jurisdiction blocked");
    });

    it("should block when global concentration cap is exceeded", async function () {
      // Set global cap keyed to tokenRole (simulates the calling token)
      await compliance.connect(admin).setGlobalConcentrationCap(tokenRole.address, 500n);

      // Call checkModules from tokenRole so msg.sender = token address
      const [ok, reason] = await compliance.connect(tokenRole).checkModules(
        alice.address, bob.address,
        100n, 600n, // toBalance = 600 > cap 500
        toBytes2Hex("HK"), toBytes2Hex("HK")
      );
      expect(ok).to.be.false;
      expect(reason).to.include("concentration cap exceeded");
    });

    it("should block when per-investor concentration cap is exceeded", async function () {
      // Set per-investor cap keyed to tokenRole (simulates the calling token)
      await compliance.connect(admin).setConcentrationCap(tokenRole.address, bob.address, 300n);

      // Call checkModules from tokenRole so msg.sender = token address
      const [ok, reason] = await compliance.connect(tokenRole).checkModules(
        alice.address, bob.address,
        100n, 400n, // toBalance = 400 > cap 300
        toBytes2Hex("HK"), toBytes2Hex("HK")
      );
      expect(ok).to.be.false;
      expect(reason).to.include("concentration cap exceeded");
    });
  });

  // ---------------------------------------------------------------------------
  // Oracle management
  // ---------------------------------------------------------------------------

  describe("Oracle management", function () {
    it("should allow admin to update oracle", async function () {
      await expect(compliance.connect(admin).setComplianceOracle(attacker.address))
        .to.emit(compliance, "OracleUpdated")
        .withArgs(oracle.address, attacker.address);

      expect(await compliance.complianceOracle()).to.equal(attacker.address);
    });

    it("should reject zero address as oracle", async function () {
      await expect(
        compliance.connect(admin).setComplianceOracle(ethers.ZeroAddress)
      ).to.be.revertedWith("HKSTPCompliance: zero oracle");
    });

    it("should reject oracle update from non-admin", async function () {
      await expect(
        compliance.connect(alice).setComplianceOracle(attacker.address)
      ).to.be.reverted;
    });
  });
});
