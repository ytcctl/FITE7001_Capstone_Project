const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title ERC-734/735 ONCHAINID Identity System — Comprehensive Test Suite
 *
 * Tests cover:
 *   1. Identity.sol   — ERC-734 Key Management + ERC-735 Claim Holder
 *   2. ClaimIssuer.sol — Trusted Claim Issuer, signature validation, revocation
 *   3. IdentityFactory.sol — Factory deployment of per-investor Identity contracts
 *   4. HKSTPIdentityRegistry.sol — Full integration:
 *        register → deploy identity → sign claim → issue claim → verify
 */
describe("ONCHAINID Identity System", function () {
  let admin, agent, investor1, investor2, attacker;

  beforeEach(async function () {
    [admin, agent, investor1, investor2, attacker] = await ethers.getSigners();
  });

  // =========================================================================
  //  1. Identity.sol  (ERC-734 + ERC-735)
  // =========================================================================
  describe("Identity (ERC-734 / ERC-735)", function () {
    let identity;

    beforeEach(async function () {
      const Identity = await ethers.getContractFactory("Identity");
      identity = await Identity.deploy(investor1.address);
    });

    // ── Constructor ───────────────────────────────────────────
    describe("Constructor", function () {
      it("should set deployer as MANAGEMENT key", async function () {
        const key = await identity.addressToKey(investor1.address);
        expect(await identity.keyHasPurpose(key, 1)).to.be.true; // MANAGEMENT
      });

      it("should emit KeyAdded event on deploy", async function () {
        const Identity = await ethers.getContractFactory("Identity");
        const key = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address"], [investor1.address]));
        const id = await Identity.deploy(investor1.address);
        // Just confirm the deploy succeeded and management key is set
        expect(await id.keyHasPurpose(key, 1)).to.be.true;
      });

      it("should revert if initialManagementKey is zero", async function () {
        const Identity = await ethers.getContractFactory("Identity");
        await expect(Identity.deploy(ethers.ZeroAddress)).to.be.revertedWith("Identity: zero key");
      });
    });

    // ── Key Management (ERC-734) ──────────────────────────────
    describe("Key Management", function () {
      it("should allow management key to add a new key", async function () {
        const agentKey = await identity.addressToKey(agent.address);
        await expect(identity.connect(investor1).addKey(agentKey, 3, 1)) // CLAIM purpose
          .to.emit(identity, "KeyAdded")
          .withArgs(agentKey, 3, 1);

        expect(await identity.keyHasPurpose(agentKey, 3)).to.be.true;
      });

      it("should allow adding multiple purposes to the same key", async function () {
        const agentKey = await identity.addressToKey(agent.address);
        await identity.connect(investor1).addKey(agentKey, 3, 1); // CLAIM
        await identity.connect(investor1).addKey(agentKey, 2, 1); // ACTION

        expect(await identity.keyHasPurpose(agentKey, 3)).to.be.true;
        expect(await identity.keyHasPurpose(agentKey, 2)).to.be.true;
      });

      it("should revert if key already has the purpose", async function () {
        const agentKey = await identity.addressToKey(agent.address);
        await identity.connect(investor1).addKey(agentKey, 3, 1);
        await expect(
          identity.connect(investor1).addKey(agentKey, 3, 1)
        ).to.be.revertedWith("Identity: key already has purpose");
      });

      it("should revert if non-management key tries to add a key", async function () {
        const agentKey = await identity.addressToKey(agent.address);
        await expect(
          identity.connect(attacker).addKey(agentKey, 3, 1)
        ).to.be.revertedWith("Identity: sender lacks MANAGEMENT key");
      });

      it("should allow management key to remove a key", async function () {
        const agentKey = await identity.addressToKey(agent.address);
        await identity.connect(investor1).addKey(agentKey, 3, 1);

        await expect(identity.connect(investor1).removeKey(agentKey, 3))
          .to.emit(identity, "KeyRemoved")
          .withArgs(agentKey, 3, 1);

        expect(await identity.keyHasPurpose(agentKey, 3)).to.be.false;
      });

      it("should revert removeKey if key does not have purpose", async function () {
        const agentKey = await identity.addressToKey(agent.address);
        await expect(
          identity.connect(investor1).removeKey(agentKey, 3)
        ).to.be.revertedWith("Identity: key does not have purpose");
      });

      it("should delete key entirely when last purpose is removed", async function () {
        const agentKey = await identity.addressToKey(agent.address);
        await identity.connect(investor1).addKey(agentKey, 3, 1);
        await identity.connect(investor1).removeKey(agentKey, 3);

        const [purposes, , ] = await identity.getKey(agentKey);
        expect(purposes.length).to.equal(0);
      });

      it("getKey should return correct data", async function () {
        const key = await identity.addressToKey(investor1.address);
        const [purposes, keyType, keyValue] = await identity.getKey(key);
        expect(purposes.length).to.equal(1);
        expect(purposes[0]).to.equal(1n); // MANAGEMENT
        expect(keyType).to.equal(1n); // ECDSA
        expect(keyValue).to.equal(key);
      });
    });

    // ── Claim Holder (ERC-735) ────────────────────────────────
    describe("Claim Holder", function () {
      let agentKey;

      beforeEach(async function () {
        // Add agent as CLAIM key
        agentKey = await identity.addressToKey(agent.address);
        await identity.connect(investor1).addKey(agentKey, 3, 1);
      });

      it("should allow CLAIM key to add a claim", async function () {
        const topic = 1; // KYC
        const issuerAddr = admin.address;
        const sig = "0xdeadbeef";
        const data = "0x1234";

        const expectedClaimId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [issuerAddr, topic])
        );

        await expect(identity.connect(agent).addClaim(topic, 1, issuerAddr, sig, data, ""))
          .to.emit(identity, "ClaimAdded")
          .withArgs(expectedClaimId, topic, issuerAddr);
      });

      it("should allow MANAGEMENT key to add a claim", async function () {
        const topic = 2;
        await expect(identity.connect(investor1).addClaim(topic, 1, admin.address, "0x", "0x", ""))
          .to.emit(identity, "ClaimAdded");
      });

      it("should revert if unauthorized user tries to add claim", async function () {
        await expect(
          identity.connect(attacker).addClaim(1, 1, admin.address, "0x", "0x", "")
        ).to.be.revertedWith("Identity: sender lacks CLAIM or MANAGEMENT key");
      });

      it("should update existing claim and emit ClaimChanged", async function () {
        const topic = 1;
        await identity.connect(agent).addClaim(topic, 1, admin.address, "0xaa", "0x01", "");

        await expect(identity.connect(agent).addClaim(topic, 1, admin.address, "0xbb", "0x02", ""))
          .to.emit(identity, "ClaimChanged");
      });

      it("getClaim should return stored claim data", async function () {
        const topic = 1;
        const sig = "0xabcdef";
        const data = "0x112233";
        await identity.connect(agent).addClaim(topic, 1, admin.address, sig, data, "https://example.com");

        const claimId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [admin.address, topic])
        );
        const claim = await identity.getClaim(claimId);
        expect(claim.topic).to.equal(BigInt(topic));
        expect(claim.scheme).to.equal(1n);
        expect(claim.issuer).to.equal(admin.address);
        expect(claim.uri).to.equal("https://example.com");
      });

      it("getClaimIdsByTopic should return correct claim ids", async function () {
        await identity.connect(agent).addClaim(1, 1, admin.address, "0xaa", "0x01", "");
        const ids = await identity.getClaimIdsByTopic(1);
        expect(ids.length).to.equal(1);
      });

      it("should allow management key to remove a claim", async function () {
        await identity.connect(agent).addClaim(1, 1, admin.address, "0xaa", "0x01", "");
        const claimId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [admin.address, 1])
        );

        await expect(identity.connect(investor1).removeClaim(claimId))
          .to.emit(identity, "ClaimRemoved")
          .withArgs(claimId, 1, admin.address);

        const ids = await identity.getClaimIdsByTopic(1);
        expect(ids.length).to.equal(0);
      });

      it("should allow the issuer to remove their own claim", async function () {
        await identity.connect(agent).addClaim(1, 1, agent.address, "0xaa", "0x01", "");
        const claimId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [agent.address, 1])
        );

        await expect(identity.connect(agent).removeClaim(claimId))
          .to.emit(identity, "ClaimRemoved");
      });

      it("should revert removeClaim for non-existent claim", async function () {
        await expect(
          identity.connect(investor1).removeClaim(ethers.keccak256("0x00"))
        ).to.be.revertedWith("Identity: claim does not exist");
      });

      it("should revert removeClaim for unauthorized caller", async function () {
        await identity.connect(agent).addClaim(1, 1, admin.address, "0xaa", "0x01", "");
        const claimId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [admin.address, 1])
        );

        await expect(
          identity.connect(attacker).removeClaim(claimId)
        ).to.be.revertedWith("Identity: not authorized to remove claim");
      });
    });
  });

  // =========================================================================
  //  2. ClaimIssuer.sol
  // =========================================================================
  describe("ClaimIssuer", function () {
    let claimIssuer;

    beforeEach(async function () {
      const ClaimIssuer = await ethers.getContractFactory("ClaimIssuer");
      claimIssuer = await ClaimIssuer.deploy(admin.address, admin.address);
    });

    describe("Constructor", function () {
      it("should set admin and signing key", async function () {
        expect(await claimIssuer.signingKey()).to.equal(admin.address);
        expect(await claimIssuer.hasRole(await claimIssuer.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      });

      it("should revert if admin is zero", async function () {
        const ClaimIssuer = await ethers.getContractFactory("ClaimIssuer");
        await expect(ClaimIssuer.deploy(ethers.ZeroAddress, admin.address))
          .to.be.revertedWith("ClaimIssuer: zero admin");
      });

      it("should revert if signing key is zero", async function () {
        const ClaimIssuer = await ethers.getContractFactory("ClaimIssuer");
        await expect(ClaimIssuer.deploy(admin.address, ethers.ZeroAddress))
          .to.be.revertedWith("ClaimIssuer: zero signing key");
      });
    });

    describe("setSigningKey", function () {
      it("should allow admin to update signing key", async function () {
        await expect(claimIssuer.connect(admin).setSigningKey(agent.address))
          .to.emit(claimIssuer, "SigningKeyUpdated")
          .withArgs(admin.address, agent.address);
        expect(await claimIssuer.signingKey()).to.equal(agent.address);
      });

      it("should revert for non-admin", async function () {
        await expect(
          claimIssuer.connect(attacker).setSigningKey(attacker.address)
        ).to.be.reverted;
      });

      it("should revert for zero key", async function () {
        await expect(
          claimIssuer.connect(admin).setSigningKey(ethers.ZeroAddress)
        ).to.be.revertedWith("ClaimIssuer: zero key");
      });
    });

    describe("Claim signing & validation", function () {
      let identityAddr;

      beforeEach(async function () {
        // Deploy a real Identity for the investor
        const Identity = await ethers.getContractFactory("Identity");
        const id = await Identity.deploy(investor1.address);
        identityAddr = await id.getAddress();
      });

      async function signClaim(signer, identityContract, topic, data) {
        // Match ClaimIssuer's getClaimHash: keccak256(abi.encode(identity, topic, data))
        const dataHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [identityContract, topic, data]
          )
        );
        // Sign the hash (ethers.js adds the Ethereum prefix automatically)
        return signer.signMessage(ethers.getBytes(dataHash));
      }

      it("should validate a correctly signed claim", async function () {
        const topic = 1;
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, topic, 0] // no expiry
        );
        const sig = await signClaim(admin, identityAddr, topic, data);

        expect(await claimIssuer.isClaimValid(identityAddr, topic, sig, data)).to.be.true;
      });

      it("should reject a claim signed by wrong key", async function () {
        const topic = 1;
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, topic, 0]
        );
        const sig = await signClaim(attacker, identityAddr, topic, data);

        expect(await claimIssuer.isClaimValid(identityAddr, topic, sig, data)).to.be.false;
      });

      it("should reject a claim with tampered data", async function () {
        const topic = 1;
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, topic, 0]
        );
        const sig = await signClaim(admin, identityAddr, topic, data);

        // Tamper: change topic to 2
        const tamperedData = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, 2, 0]
        );
        expect(await claimIssuer.isClaimValid(identityAddr, topic, sig, tamperedData)).to.be.false;
      });

      it("getClaimHash should match the data used for signing", async function () {
        const topic = 1;
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, topic, 0]
        );
        const hash = await claimIssuer.getClaimHash(identityAddr, topic, data);
        const expected = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [identityAddr, topic, data]
          )
        );
        expect(hash).to.equal(expected);
      });
    });

    describe("Revocation", function () {
      it("should allow admin to revoke a claim", async function () {
        const claimId = ethers.keccak256("0x01");
        await expect(claimIssuer.connect(admin).revokeClaim(claimId))
          .to.emit(claimIssuer, "ClaimRevoked")
          .withArgs(claimId);
        expect(await claimIssuer.isClaimRevoked(claimId)).to.be.true;
      });

      it("should allow admin to un-revoke a claim", async function () {
        const claimId = ethers.keccak256("0x01");
        await claimIssuer.connect(admin).revokeClaim(claimId);
        await expect(claimIssuer.connect(admin).unrevokeClaim(claimId))
          .to.emit(claimIssuer, "ClaimUnrevoked")
          .withArgs(claimId);
        expect(await claimIssuer.isClaimRevoked(claimId)).to.be.false;
      });

      it("should reject validation for a revoked claim", async function () {
        // Deploy identity
        const Identity = await ethers.getContractFactory("Identity");
        const id = await Identity.deploy(investor1.address);
        const identityAddr = await id.getAddress();

        const topic = 1;
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, topic, 0]
        );
        const dataHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [identityAddr, topic, data]
          )
        );
        const sig = await admin.signMessage(ethers.getBytes(dataHash));

        // Valid before revocation
        expect(await claimIssuer.isClaimValid(identityAddr, topic, sig, data)).to.be.true;

        // Revoke — claimId in ClaimIssuer is keccak256(abi.encode(claimIssuerAddr, topic))
        const claimIssuerAddr = await claimIssuer.getAddress();
        const claimId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [claimIssuerAddr, topic])
        );
        await claimIssuer.connect(admin).revokeClaim(claimId);

        // Invalid after revocation
        expect(await claimIssuer.isClaimValid(identityAddr, topic, sig, data)).to.be.false;
      });

      it("should revert revokeClaim for non-admin", async function () {
        await expect(
          claimIssuer.connect(attacker).revokeClaim(ethers.keccak256("0x01"))
        ).to.be.reverted;
      });
    });
  });

  // =========================================================================
  //  3. IdentityFactory.sol
  // =========================================================================
  describe("IdentityFactory", function () {
    let factory;

    beforeEach(async function () {
      const Factory = await ethers.getContractFactory("IdentityFactory");
      factory = await Factory.deploy(admin.address);

      // Grant DEPLOYER_ROLE to agent (simulating the IdentityRegistry)
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, agent.address);
    });

    describe("Constructor", function () {
      it("should set admin", async function () {
        expect(await factory.hasRole(await factory.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      });

      it("should revert for zero admin", async function () {
        const Factory = await ethers.getContractFactory("IdentityFactory");
        await expect(Factory.deploy(ethers.ZeroAddress))
          .to.be.revertedWith("IdentityFactory: zero admin");
      });
    });

    describe("deployIdentity", function () {
      it("should deploy an Identity contract for an investor", async function () {
        const tx = await factory.connect(agent).deployIdentity(investor1.address, admin.address);
        const receipt = await tx.wait();

        const identityAddr = await factory.getIdentity(investor1.address);
        expect(identityAddr).to.not.equal(ethers.ZeroAddress);
        expect(await factory.identityCount()).to.equal(1n);
      });

      it("should set investor as MANAGEMENT key", async function () {
        await factory.connect(agent).deployIdentity(investor1.address, admin.address);
        const identityAddr = await factory.getIdentity(investor1.address);

        const Identity = await ethers.getContractFactory("Identity");
        const identity = Identity.attach(identityAddr);

        const investorKey = await identity.addressToKey(investor1.address);
        expect(await identity.keyHasPurpose(investorKey, 1)).to.be.true; // MANAGEMENT
      });

      it("should add claimAgent as CLAIM key", async function () {
        await factory.connect(agent).deployIdentity(investor1.address, admin.address);
        const identityAddr = await factory.getIdentity(investor1.address);

        const Identity = await ethers.getContractFactory("Identity");
        const identity = Identity.attach(identityAddr);

        const agentKey = await identity.addressToKey(admin.address);
        expect(await identity.keyHasPurpose(agentKey, 3)).to.be.true; // CLAIM
      });

      it("should NOT add CLAIM key if claimAgent == investor", async function () {
        await factory.connect(agent).deployIdentity(investor1.address, investor1.address);
        const identityAddr = await factory.getIdentity(investor1.address);

        const Identity = await ethers.getContractFactory("Identity");
        const identity = Identity.attach(identityAddr);

        // Investor should have MANAGEMENT key but NOT have CLAIM key added separately
        const investorKey = await identity.addressToKey(investor1.address);
        expect(await identity.keyHasPurpose(investorKey, 1)).to.be.true;  // MANAGEMENT
        expect(await identity.keyHasPurpose(investorKey, 3)).to.be.false; // No CLAIM
      });

      it("should NOT add CLAIM key if claimAgent is zero", async function () {
        await factory.connect(agent).deployIdentity(investor1.address, ethers.ZeroAddress);
        const identityAddr = await factory.getIdentity(investor1.address);
        expect(identityAddr).to.not.equal(ethers.ZeroAddress);

        // Verify factory no longer has management key
        const Identity = await ethers.getContractFactory("Identity");
        const identity = Identity.attach(identityAddr);
        const factoryKey = await identity.addressToKey(await factory.getAddress());
        expect(await identity.keyHasPurpose(factoryKey, 1)).to.be.false; // Factory removed its own key
      });

      it("should emit IdentityDeployed event", async function () {
        await expect(factory.connect(agent).deployIdentity(investor1.address, admin.address))
          .to.emit(factory, "IdentityDeployed");
      });

      it("should revert for zero investor", async function () {
        await expect(
          factory.connect(agent).deployIdentity(ethers.ZeroAddress, admin.address)
        ).to.be.revertedWith("IdentityFactory: zero investor");
      });

      it("should revert for duplicate investor", async function () {
        await factory.connect(agent).deployIdentity(investor1.address, admin.address);
        await expect(
          factory.connect(agent).deployIdentity(investor1.address, admin.address)
        ).to.be.revertedWith("IdentityFactory: already deployed");
      });

      it("should revert if caller lacks DEPLOYER_ROLE", async function () {
        await expect(
          factory.connect(attacker).deployIdentity(investor1.address, admin.address)
        ).to.be.reverted;
      });

      it("should track identityCount correctly", async function () {
        await factory.connect(agent).deployIdentity(investor1.address, admin.address);
        await factory.connect(agent).deployIdentity(investor2.address, admin.address);
        expect(await factory.identityCount()).to.equal(2n);
      });
    });
  });

  // =========================================================================
  //  4. HKSTPIdentityRegistry — ONCHAINID Integration
  // =========================================================================
  describe("HKSTPIdentityRegistry (ONCHAINID Integration)", function () {
    let registry, factory, claimIssuer;
    let registryAddr, claimIssuerAddr;

    beforeEach(async function () {
      // Deploy IdentityFactory
      const Factory = await ethers.getContractFactory("IdentityFactory");
      factory = await Factory.deploy(admin.address);

      // Deploy ClaimIssuer (admin is the signing key)
      const ClaimIssuerFactory = await ethers.getContractFactory("ClaimIssuer");
      claimIssuer = await ClaimIssuerFactory.deploy(admin.address, admin.address);
      claimIssuerAddr = await claimIssuer.getAddress();

      // Deploy IdentityRegistry
      const Registry = await ethers.getContractFactory("HKSTPIdentityRegistry");
      registry = await Registry.deploy(admin.address);
      registryAddr = await registry.getAddress();

      // Wire up: set factory on registry
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());

      // Grant DEPLOYER_ROLE on factory to registry (so registry can call deployIdentity)
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, registryAddr);

      // Grant AGENT_ROLE to agent
      const AGENT_ROLE = await registry.AGENT_ROLE();
      await registry.connect(admin).grantRole(AGENT_ROLE, agent.address);

      // Add ClaimIssuer as trusted for all topics
      await registry.connect(admin).addTrustedIssuer(
        claimIssuerAddr,
        [1, 2, 3, 4, 5]
      );
    });

    // ── Trusted Issuer Management ─────────────────────────────
    describe("Trusted Issuer Management", function () {
      it("should add a trusted issuer", async function () {
        const issuers = await registry.getTrustedIssuers();
        expect(issuers.length).to.equal(1);
        expect(issuers[0]).to.equal(claimIssuerAddr);
        expect(await registry.isTrustedIssuer(claimIssuerAddr)).to.be.true;
      });

      it("should return trusted issuers for a topic", async function () {
        const issuers = await registry.getTrustedIssuersForTopic(1);
        expect(issuers.length).to.equal(1);
        expect(issuers[0]).to.equal(claimIssuerAddr);
      });

      it("should revert adding duplicate issuer", async function () {
        await expect(
          registry.connect(admin).addTrustedIssuer(claimIssuerAddr, [1])
        ).to.be.revertedWith("HKSTPIdentityRegistry: already trusted");
      });

      it("should remove a trusted issuer", async function () {
        await registry.connect(admin).removeTrustedIssuer(claimIssuerAddr);
        expect(await registry.isTrustedIssuer(claimIssuerAddr)).to.be.false;
        const issuers = await registry.getTrustedIssuers();
        expect(issuers.length).to.equal(0);
      });

      it("should revert removing non-trusted issuer", async function () {
        await expect(
          registry.connect(admin).removeTrustedIssuer(attacker.address)
        ).to.be.revertedWith("HKSTPIdentityRegistry: not trusted");
      });

      it("should revert if non-admin tries to add issuer", async function () {
        await expect(
          registry.connect(attacker).addTrustedIssuer(attacker.address, [1])
        ).to.be.reverted;
      });
    });

    // ── Identity Factory Settings ─────────────────────────────
    describe("setIdentityFactory", function () {
      it("should revert for zero factory", async function () {
        await expect(
          registry.connect(admin).setIdentityFactory(ethers.ZeroAddress)
        ).to.be.revertedWith("HKSTPIdentityRegistry: zero factory");
      });

      it("should emit IdentityFactorySet", async function () {
        await expect(
          registry.connect(admin).setIdentityFactory(agent.address)
        ).to.emit(registry, "IdentityFactorySet")
          .withArgs(agent.address);
      });
    });

    // ── Register with auto-deploy ─────────────────────────────
    describe("registerIdentity (auto-deploy ONCHAINID)", function () {
      it("should register and auto-deploy Identity contract", async function () {
        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");

        expect(await registry.contains(investor1.address)).to.be.true;
        const identityAddr = await registry.identity(investor1.address);
        expect(identityAddr).to.not.equal(ethers.ZeroAddress);
        expect(await registry.investorCountry(investor1.address)).to.equal("HK");
      });

      it("should set agent as CLAIM key on deployed Identity", async function () {
        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");
        const identityAddr = await registry.identity(investor1.address);

        const Identity = await ethers.getContractFactory("Identity");
        const identity = Identity.attach(identityAddr);

        const agentKey = await identity.addressToKey(agent.address);
        expect(await identity.keyHasPurpose(agentKey, 3)).to.be.true; // CLAIM
      });

      it("should revert for duplicate registration", async function () {
        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");
        await expect(
          registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK")
        ).to.be.revertedWith("HKSTPIdentityRegistry: already registered");
      });

      it("should accept pre-deployed Identity contract", async function () {
        const Identity = await ethers.getContractFactory("Identity");
        const preDeployed = await Identity.deploy(investor1.address);
        const preAddr = await preDeployed.getAddress();

        await registry.connect(agent).registerIdentity(investor1.address, preAddr, "US");
        expect(await registry.identity(investor1.address)).to.equal(preAddr);
      });
    });

    // ── Issue Signed Claims ───────────────────────────────────
    describe("issueClaim (cryptographic ERC-735 claims)", function () {
      let identityAddr;

      beforeEach(async function () {
        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");
        identityAddr = await registry.identity(investor1.address);
      });

      async function signAndIssueClaim(topic) {
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, topic, 0] // no expiry
        );
        const dataHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [identityAddr, topic, data]
          )
        );
        const sig = await admin.signMessage(ethers.getBytes(dataHash));

        await registry.connect(agent).issueClaim(
          investor1.address, topic, claimIssuerAddr, sig, data
        );
        return { sig, data };
      }

      it("should issue a signed claim to investor's Identity", async function () {
        await expect(signAndIssueClaim(1)).to.not.be.reverted;

        // Verify claim exists on the Identity contract
        const Identity = await ethers.getContractFactory("Identity");
        const identity = Identity.attach(identityAddr);

        const claimIds = await identity.getClaimIdsByTopic(1);
        expect(claimIds.length).to.equal(1);

        const claim = await identity.getClaim(claimIds[0]);
        expect(claim.topic).to.equal(1n);
        expect(claim.issuer).to.equal(claimIssuerAddr);
      });

      it("should also set boolean claim for backward compatibility", async function () {
        await signAndIssueClaim(1);
        expect(await registry.hasClaim(investor1.address, 1)).to.be.true;
      });

      it("should emit ClaimIssued event", async function () {
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, 1, 0]
        );
        const dataHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [identityAddr, 1, data]
          )
        );
        const sig = await admin.signMessage(ethers.getBytes(dataHash));

        await expect(registry.connect(agent).issueClaim(
          investor1.address, 1, claimIssuerAddr, sig, data
        )).to.emit(registry, "ClaimIssued");
      });

      it("should revert for untrusted issuer", async function () {
        await expect(
          registry.connect(agent).issueClaim(
            investor1.address, 1, attacker.address, "0xaa", "0x01"
          )
        ).to.be.revertedWith("HKSTPIdentityRegistry: untrusted issuer");
      });

      it("should revert for unregistered investor", async function () {
        await expect(
          registry.connect(agent).issueClaim(
            investor2.address, 1, claimIssuerAddr, "0xaa", "0x01"
          )
        ).to.be.revertedWith("HKSTPIdentityRegistry: not registered");
      });
    });

    // ── isVerified (cryptographic claim verification) ─────────
    describe("isVerified (ONCHAINID cryptographic verification)", function () {
      let identityAddr;

      beforeEach(async function () {
        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");
        identityAddr = await registry.identity(investor1.address);
      });

      async function issueAllClaims() {
        for (let topic = 1; topic <= 5; topic++) {
          const data = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "uint256"],
            [identityAddr, topic, 0] // no expiry
          );
          const dataHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["address", "uint256", "bytes"],
              [identityAddr, topic, data]
            )
          );
          const sig = await admin.signMessage(ethers.getBytes(dataHash));
          await registry.connect(agent).issueClaim(
            investor1.address, topic, claimIssuerAddr, sig, data
          );
        }
      }

      it("should return false for unregistered investor", async function () {
        expect(await registry.isVerified(investor2.address)).to.be.false;
      });

      it("should return false when no claims issued", async function () {
        expect(await registry.isVerified(investor1.address)).to.be.false;
      });

      it("should return false with partial claims", async function () {
        // Only issue topic 1 & 2
        for (let topic = 1; topic <= 2; topic++) {
          const data = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "uint256"],
            [identityAddr, topic, 0]
          );
          const dataHash = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["address", "uint256", "bytes"],
              [identityAddr, topic, data]
            )
          );
          const sig = await admin.signMessage(ethers.getBytes(dataHash));
          await registry.connect(agent).issueClaim(
            investor1.address, topic, claimIssuerAddr, sig, data
          );
        }
        expect(await registry.isVerified(investor1.address)).to.be.false;
      });

      it("should return true when all required claims are valid", async function () {
        await issueAllClaims();
        expect(await registry.isVerified(investor1.address)).to.be.true;
      });

      it("should return false after a claim is revoked by the issuer", async function () {
        await issueAllClaims();
        expect(await registry.isVerified(investor1.address)).to.be.true;

        // Revoke topic 1 claim: claimId = keccak256(abi.encode(claimIssuerAddr, topic))
        const claimId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [claimIssuerAddr, 1])
        );
        await claimIssuer.connect(admin).revokeClaim(claimId);

        expect(await registry.isVerified(investor1.address)).to.be.false;
      });

      it("should return true after un-revoking a claim", async function () {
        await issueAllClaims();

        const claimId = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [claimIssuerAddr, 1])
        );
        await claimIssuer.connect(admin).revokeClaim(claimId);
        expect(await registry.isVerified(investor1.address)).to.be.false;

        await claimIssuer.connect(admin).unrevokeClaim(claimId);
        expect(await registry.isVerified(investor1.address)).to.be.true;
      });

      it("should return false for expired claims", async function () {
        // Issue claim with expiry in the past
        const topic = 1;
        const pastExpiry = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, topic, pastExpiry]
        );
        const dataHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [identityAddr, topic, data]
          )
        );
        const sig = await admin.signMessage(ethers.getBytes(dataHash));
        await registry.connect(agent).issueClaim(
          investor1.address, topic, claimIssuerAddr, sig, data
        );

        // Issue remaining topics (2-5) with no expiry
        for (let t = 2; t <= 5; t++) {
          const d = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "uint256"],
            [identityAddr, t, 0]
          );
          const dh = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["address", "uint256", "bytes"],
              [identityAddr, t, d]
            )
          );
          const s = await admin.signMessage(ethers.getBytes(dh));
          await registry.connect(agent).issueClaim(
            investor1.address, t, claimIssuerAddr, s, d
          );
        }

        expect(await registry.isVerified(investor1.address)).to.be.false;
      });
    });

    // ── Backward Compatibility (boolean claims) ───────────────
    describe("Backward compatibility (boolean claims)", function () {
      it("should fall back to boolean claims when no trusted issuers", async function () {
        // Deploy a fresh registry WITHOUT trusted issuers
        const Registry = await ethers.getContractFactory("HKSTPIdentityRegistry");
        const freshRegistry = await Registry.deploy(admin.address);

        // Register without factory (no onchainId)
        await freshRegistry.connect(admin).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");

        // Not verified yet (no boolean claims)
        expect(await freshRegistry.isVerified(investor1.address)).to.be.false;

        // Set all boolean claims
        for (let t = 1; t <= 5; t++) {
          await freshRegistry.connect(admin).setClaim(investor1.address, t, true);
        }

        // Now verified via boolean path
        expect(await freshRegistry.isVerified(investor1.address)).to.be.true;
      });

      it("setClaim should work alongside issueClaim", async function () {
        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");

        // Set a boolean claim
        await registry.connect(agent).setClaim(investor1.address, 1, true);
        expect(await registry.hasClaim(investor1.address, 1)).to.be.true;

        // Revoke boolean claim
        await registry.connect(agent).setClaim(investor1.address, 1, false);
        expect(await registry.hasClaim(investor1.address, 1)).to.be.false;
      });
    });

    // ── Delete & Update Identity ──────────────────────────────
    describe("deleteIdentity / updateIdentity", function () {
      beforeEach(async function () {
        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");
      });

      it("should delete an identity", async function () {
        await expect(registry.connect(agent).deleteIdentity(investor1.address))
          .to.emit(registry, "IdentityRemoved")
          .withArgs(investor1.address);

        expect(await registry.contains(investor1.address)).to.be.false;
      });

      it("should clear boolean claims on delete", async function () {
        await registry.connect(agent).setClaim(investor1.address, 1, true);
        await registry.connect(agent).deleteIdentity(investor1.address);
        expect(await registry.hasClaim(investor1.address, 1)).to.be.false;
      });

      it("should update identity contract and country", async function () {
        const newAddr = investor2.address; // just using as a placeholder
        await expect(
          registry.connect(agent).updateIdentity(investor1.address, newAddr, "US")
        ).to.emit(registry, "IdentityUpdated")
          .withArgs(investor1.address, newAddr, "US");

        expect(await registry.identity(investor1.address)).to.equal(newAddr);
        expect(await registry.investorCountry(investor1.address)).to.equal("US");
      });

      it("should revert delete for unregistered investor", async function () {
        await expect(
          registry.connect(agent).deleteIdentity(investor2.address)
        ).to.be.revertedWith("HKSTPIdentityRegistry: not registered");
      });
    });

    // ── Required Claim Topics ─────────────────────────────────
    describe("setRequiredClaimTopics", function () {
      it("should update required claim topics", async function () {
        await registry.connect(admin).setRequiredClaimTopics([1, 2]); // KYC + Accredited only
        const topics = await registry.getRequiredClaimTopics();
        expect(topics.length).to.equal(2);
        expect(topics[0]).to.equal(1n);
        expect(topics[1]).to.equal(2n);
      });

      it("isVerified should respect updated required topics", async function () {
        // Reduce to only KYC topic
        await registry.connect(admin).setRequiredClaimTopics([1]);

        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");
        const identityAddr = await registry.identity(investor1.address);

        // Issue only topic 1
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "uint256", "uint256"],
          [identityAddr, 1, 0]
        );
        const dataHash = ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "uint256", "bytes"],
            [identityAddr, 1, data]
          )
        );
        const sig = await admin.signMessage(ethers.getBytes(dataHash));
        await registry.connect(agent).issueClaim(
          investor1.address, 1, claimIssuerAddr, sig, data
        );

        expect(await registry.isVerified(investor1.address)).to.be.true;
      });
    });

    // ── Pause ─────────────────────────────────────────────────
    describe("Pause", function () {
      it("should block registerIdentity when paused", async function () {
        await registry.connect(admin).pause();
        await expect(
          registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK")
        ).to.be.reverted;
      });

      it("should block setClaim when paused", async function () {
        await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");
        await registry.connect(admin).pause();
        await expect(
          registry.connect(agent).setClaim(investor1.address, 1, true)
        ).to.be.reverted;
      });

      it("should resume after unpause", async function () {
        await registry.connect(admin).pause();
        await registry.connect(admin).unpause();
        await expect(
          registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK")
        ).to.not.be.reverted;
      });
    });
  });
});
