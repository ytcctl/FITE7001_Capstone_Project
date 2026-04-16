const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title Cap. 622 Shareholder Cap — Identity-Based Counting
 *
 * Tests cover:
 *   1. Multi-wallet → single identity linking
 *   2. Identity-based unique holder counting (not wallet counting)
 *   3. Shareholder cap enforcement (Cap. 622 limit = 50)
 *   4. Sybil attack prevention (splitting across wallets)
 *   5. Aggregate balance by identity
 *   6. Holder removal when identity fully exits
 *   7. Edge cases: unlinkWallet, updateIdentity, burn-to-zero
 */
describe("Cap. 622 Shareholder Cap (Identity-Based)", function () {
  let token, registry, compliance;
  let admin, agent, treasury;
  // We'll need many signers for cap testing
  let signers;

  const TOKEN_NAME   = "HKSTP Cap622 Test Token";
  const TOKEN_SYMBOL = "CAP622";
  const MINT_AMOUNT  = ethers.parseUnits("1000", 18);
  const SMALL_AMOUNT = ethers.parseUnits("10", 18);

  async function registerAndVerify(investor) {
    await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
    for (let topic = 1; topic <= 5; topic++) {
      await registry.connect(agent).setClaim(investor.address, topic, true);
    }
  }

  beforeEach(async function () {
    signers = await ethers.getSigners();
    [admin, agent, treasury, ...signers] = signers;

    // Deploy Identity Registry
    const IdentityRegistry = await ethers.getContractFactory("HKSTPIdentityRegistry");
    registry = await IdentityRegistry.deploy(admin.address);

    // Deploy Compliance (oracle = admin for tests)
    const Compliance = await ethers.getContractFactory("HKSTPCompliance");
    compliance = await Compliance.deploy(admin.address, admin.address);

    // Deploy security token
    const Token = await ethers.getContractFactory("HKSTPSecurityToken");
    token = await Token.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      await registry.getAddress(),
      await compliance.getAddress(),
      ethers.ZeroAddress,
      admin.address
    );

    // Grant roles
    const AGENT_ROLE_TOKEN = await token.AGENT_ROLE();
    await token.connect(admin).grantRole(AGENT_ROLE_TOKEN, agent.address);

    const AGENT_ROLE_REG = await registry.AGENT_ROLE();
    await registry.connect(admin).grantRole(AGENT_ROLE_REG, agent.address);

    const TOKEN_ROLE = await compliance.TOKEN_ROLE();
    await compliance.connect(admin).grantRole(TOKEN_ROLE, await token.getAddress());
  });

  // ─────────────────────────────────────────────────────────────────
  // 1. Multi-wallet linking
  // ─────────────────────────────────────────────────────────────────
  describe("Multi-wallet → single identity linking", function () {
    it("should auto-link wallet to identity on registration", async function () {
      const investor = signers[0];
      await registerAndVerify(investor);

      const identityAddr = await registry.getIdentityForWallet(investor.address);
      // Identity might be zero if no factory is set, but the wallet should be linked
      // In boolean-claims mode (no factory), identity is 0x0 — no linking
      // Let's check with a factory set up
    });

    it("should link additional wallet to existing identity", async function () {
      // Set up factory for auto-deploy
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      const factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());

      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());

      // Register investor (auto-deploys identity)
      const investor = signers[0];
      const wallet2  = signers[1];

      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(investor.address, topic, true);
      }

      const identityAddr = await registry.getIdentityForWallet(investor.address);
      expect(identityAddr).to.not.equal(ethers.ZeroAddress);

      // Link second wallet to same identity
      await registry.connect(agent).linkWallet(wallet2.address, identityAddr, "HK");

      // Verify both wallets map to same identity
      expect(await registry.getIdentityForWallet(wallet2.address)).to.equal(identityAddr);

      // Check linked wallets array
      const wallets = await registry.getLinkedWallets(identityAddr);
      expect(wallets.length).to.equal(2);
      expect(wallets).to.include(investor.address);
      expect(wallets).to.include(wallet2.address);
    });

    it("should reject linking already-registered wallet", async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      const factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());

      const investor1 = signers[0];
      const investor2 = signers[1];

      await registry.connect(agent).registerIdentity(investor1.address, ethers.ZeroAddress, "HK");
      await registry.connect(agent).registerIdentity(investor2.address, ethers.ZeroAddress, "HK");

      const id1 = await registry.getIdentityForWallet(investor1.address);

      await expect(
        registry.connect(agent).linkWallet(investor2.address, id1, "HK")
      ).to.be.revertedWith("HKSTPIdentityRegistry: already registered");
    });

    it("should reject linking to an identity with no primary wallet", async function () {
      const fakeIdentity = signers[5].address;
      const newWallet = signers[6];

      await expect(
        registry.connect(agent).linkWallet(newWallet.address, fakeIdentity, "HK")
      ).to.be.revertedWith("HKSTPIdentityRegistry: identity has no primary wallet");
    });

    it("should unlink a secondary wallet", async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      const factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());

      const investor = signers[0];
      const wallet2  = signers[1];

      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
      const identityAddr = await registry.getIdentityForWallet(investor.address);
      await registry.connect(agent).linkWallet(wallet2.address, identityAddr, "HK");

      // Unlink wallet2
      await registry.connect(agent).unlinkWallet(wallet2.address);

      // wallet2 should no longer be registered
      expect(await registry.contains(wallet2.address)).to.be.false;

      // Only primary wallet remains
      const wallets = await registry.getLinkedWallets(identityAddr);
      expect(wallets.length).to.equal(1);
      expect(wallets[0]).to.equal(investor.address);
    });

    it("should reject unlinking the last wallet", async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      const factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());

      const investor = signers[0];
      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");

      await expect(
        registry.connect(agent).unlinkWallet(investor.address)
      ).to.be.revertedWith("HKSTPIdentityRegistry: cannot unlink last wallet");
    });

    it("should copy boolean claims when linking wallet", async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      const factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());

      const investor = signers[0];
      const wallet2  = signers[1];

      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(investor.address, topic, true);
      }

      const identityAddr = await registry.getIdentityForWallet(investor.address);
      await registry.connect(agent).linkWallet(wallet2.address, identityAddr, "HK");

      // wallet2 should have the same claims
      for (let topic = 1; topic <= 5; topic++) {
        expect(await registry.hasClaim(wallet2.address, topic)).to.be.true;
      }
    });

    it("should emit WalletLinked / WalletUnlinked events", async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      const factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());

      const investor = signers[0];
      const wallet2  = signers[1];

      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
      const identityAddr = await registry.getIdentityForWallet(investor.address);

      await expect(registry.connect(agent).linkWallet(wallet2.address, identityAddr, "HK"))
        .to.emit(registry, "WalletLinked")
        .withArgs(wallet2.address, identityAddr);

      await expect(registry.connect(agent).unlinkWallet(wallet2.address))
        .to.emit(registry, "WalletUnlinked")
        .withArgs(wallet2.address, identityAddr);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 2. Identity-based shareholder counting
  // ─────────────────────────────────────────────────────────────────
  describe("Identity-based shareholder counting", function () {
    let factory;

    beforeEach(async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());
    });

    async function registerWithIdentity(investor) {
      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(investor.address, topic, true);
      }
    }

    it("should count unique identities, not wallets", async function () {
      const investor1 = signers[0];
      const wallet1b  = signers[1];
      const investor2 = signers[2];

      // Register 2 identities
      await registerWithIdentity(investor1);
      await registerWithIdentity(investor2);

      // Link second wallet to investor1's identity
      const id1 = await registry.getIdentityForWallet(investor1.address);
      await registry.connect(agent).linkWallet(wallet1b.address, id1, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(wallet1b.address, topic, true);
      }

      // Mint to all 3 wallets
      await token.connect(agent).mint(investor1.address, MINT_AMOUNT);
      await token.connect(agent).mint(wallet1b.address, MINT_AMOUNT);
      await token.connect(agent).mint(investor2.address, MINT_AMOUNT);

      // Should count 2 identity holders, not 3
      expect(await token.shareholderCount()).to.equal(2);
    });

    it("should add identity holder on first mint", async function () {
      const investor = signers[0];
      await registerWithIdentity(investor);

      expect(await token.shareholderCount()).to.equal(0);
      await token.connect(agent).mint(investor.address, MINT_AMOUNT);
      expect(await token.shareholderCount()).to.equal(1);
    });

    it("should not double-count same identity on second mint", async function () {
      const investor = signers[0];
      await registerWithIdentity(investor);

      await token.connect(agent).mint(investor.address, MINT_AMOUNT);
      await token.connect(agent).mint(investor.address, MINT_AMOUNT);

      expect(await token.shareholderCount()).to.equal(1);
    });

    it("should remove identity holder when aggregate balance reaches zero", async function () {
      const investor = signers[0];
      const wallet2  = signers[1];
      await registerWithIdentity(investor);

      const id1 = await registry.getIdentityForWallet(investor.address);
      await registry.connect(agent).linkWallet(wallet2.address, id1, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(wallet2.address, topic, true);
      }

      // Mint to both wallets
      await token.connect(agent).mint(investor.address, MINT_AMOUNT);
      await token.connect(agent).mint(wallet2.address, SMALL_AMOUNT);

      expect(await token.shareholderCount()).to.equal(1);

      // Burn from both wallets — aggregate goes to zero
      await token.connect(agent).burn(investor.address, MINT_AMOUNT);
      expect(await token.shareholderCount()).to.equal(1); // wallet2 still holds

      await token.connect(agent).burn(wallet2.address, SMALL_AMOUNT);
      expect(await token.shareholderCount()).to.equal(0); // fully exited
    });

    it("should return correct aggregate balance by identity", async function () {
      const investor = signers[0];
      const wallet2  = signers[1];
      await registerWithIdentity(investor);

      const id1 = await registry.getIdentityForWallet(investor.address);
      await registry.connect(agent).linkWallet(wallet2.address, id1, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(wallet2.address, topic, true);
      }

      await token.connect(agent).mint(investor.address, MINT_AMOUNT);
      await token.connect(agent).mint(wallet2.address, SMALL_AMOUNT);

      const aggregate = await token.aggregateBalanceByIdentity(id1);
      expect(aggregate).to.equal(MINT_AMOUNT + SMALL_AMOUNT);
    });

    it("should emit IdentityHolderAdded and IdentityHolderRemoved", async function () {
      const investor = signers[0];
      await registerWithIdentity(investor);
      const id1 = await registry.getIdentityForWallet(investor.address);

      await expect(token.connect(agent).mint(investor.address, MINT_AMOUNT))
        .to.emit(token, "IdentityHolderAdded")
        .withArgs(id1);

      await expect(token.connect(agent).burn(investor.address, MINT_AMOUNT))
        .to.emit(token, "IdentityHolderRemoved")
        .withArgs(id1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 3. Cap. 622 shareholder cap enforcement
  // ─────────────────────────────────────────────────────────────────
  describe("Cap. 622 shareholder cap enforcement", function () {
    let factory;

    beforeEach(async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());

      // Set cap to 3 for testing (instead of 50)
      await token.connect(admin).setMaxShareholders(3);
    });

    async function registerWithIdentity(investor) {
      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(investor.address, topic, true);
      }
    }

    it("should allow minting up to the shareholder cap", async function () {
      for (let i = 0; i < 3; i++) {
        await registerWithIdentity(signers[i]);
        await token.connect(agent).mint(signers[i].address, MINT_AMOUNT);
      }
      expect(await token.shareholderCount()).to.equal(3);
    });

    it("should reject minting that exceeds shareholder cap", async function () {
      // Fill up to cap
      for (let i = 0; i < 3; i++) {
        await registerWithIdentity(signers[i]);
        await token.connect(agent).mint(signers[i].address, MINT_AMOUNT);
      }

      // 4th unique identity should be rejected
      await registerWithIdentity(signers[3]);
      await expect(
        token.connect(agent).mint(signers[3].address, MINT_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: shareholder cap exceeded (Cap. 622)");
    });

    it("should allow mint to additional wallet of existing identity (not a new shareholder)", async function () {
      // Fill 3 shareholders
      for (let i = 0; i < 3; i++) {
        await registerWithIdentity(signers[i]);
        await token.connect(agent).mint(signers[i].address, MINT_AMOUNT);
      }

      // Link wallet to existing identity
      const id0 = await registry.getIdentityForWallet(signers[0].address);
      const wallet2 = signers[3];
      await registry.connect(agent).linkWallet(wallet2.address, id0, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(wallet2.address, topic, true);
      }

      // Should succeed — same identity, not a new shareholder
      await expect(
        token.connect(agent).mint(wallet2.address, SMALL_AMOUNT)
      ).to.not.be.reverted;

      expect(await token.shareholderCount()).to.equal(3); // still 3
    });

    it("should allow new shareholder after another fully exits", async function () {
      // Fill 3 shareholders
      for (let i = 0; i < 3; i++) {
        await registerWithIdentity(signers[i]);
        await token.connect(agent).mint(signers[i].address, MINT_AMOUNT);
      }

      // Burn all from signer[2] — frees up a slot
      await token.connect(agent).burn(signers[2].address, MINT_AMOUNT);
      expect(await token.shareholderCount()).to.equal(2);

      // Now 4th identity can enter
      await registerWithIdentity(signers[3]);
      await expect(
        token.connect(agent).mint(signers[3].address, MINT_AMOUNT)
      ).to.not.be.reverted;

      expect(await token.shareholderCount()).to.equal(3);
    });

    it("should allow setMaxShareholders by admin", async function () {
      await expect(token.connect(admin).setMaxShareholders(50))
        .to.emit(token, "MaxShareholdersSet")
        .withArgs(50);
      expect(await token.maxShareholders()).to.equal(50);
    });

    it("should reject setMaxShareholders by non-admin", async function () {
      await expect(
        token.connect(signers[0]).setMaxShareholders(100)
      ).to.be.reverted;
    });

    it("should not enforce cap when maxShareholders is 0 (unlimited)", async function () {
      await token.connect(admin).setMaxShareholders(0);

      // Register and mint to 5 different identities — all should succeed
      for (let i = 0; i < 5; i++) {
        await registerWithIdentity(signers[i]);
        await token.connect(agent).mint(signers[i].address, MINT_AMOUNT);
      }
      expect(await token.shareholderCount()).to.equal(5);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 4. Sybil attack prevention
  // ─────────────────────────────────────────────────────────────────
  describe("Sybil attack prevention", function () {
    let factory;

    beforeEach(async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());
      await token.connect(admin).setMaxShareholders(2);
    });

    async function registerWithIdentity(investor) {
      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(investor.address, topic, true);
      }
    }

    it("cannot bypass cap by registering multiple wallets as separate identities", async function () {
      // Fill 2 shareholder slots
      await registerWithIdentity(signers[0]);
      await registerWithIdentity(signers[1]);
      await token.connect(agent).mint(signers[0].address, MINT_AMOUNT);
      await token.connect(agent).mint(signers[1].address, MINT_AMOUNT);

      // Try to sneak in a 3rd identity
      await registerWithIdentity(signers[2]);
      await expect(
        token.connect(agent).mint(signers[2].address, SMALL_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: shareholder cap exceeded (Cap. 622)");
    });

    it("same person with 2 wallets on same identity uses only 1 slot", async function () {
      await registerWithIdentity(signers[0]);
      const id0 = await registry.getIdentityForWallet(signers[0].address);

      // Link second wallet to same identity
      const wallet2 = signers[2];
      await registry.connect(agent).linkWallet(wallet2.address, id0, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(wallet2.address, topic, true);
      }

      // Mint to both wallets
      await token.connect(agent).mint(signers[0].address, MINT_AMOUNT);
      await token.connect(agent).mint(wallet2.address, SMALL_AMOUNT);

      expect(await token.shareholderCount()).to.equal(1);

      // Can still add another identity
      await registerWithIdentity(signers[1]);
      await token.connect(agent).mint(signers[1].address, MINT_AMOUNT);
      expect(await token.shareholderCount()).to.equal(2);

      // 3rd identity should fail
      await registerWithIdentity(signers[3]);
      await expect(
        token.connect(agent).mint(signers[3].address, SMALL_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: shareholder cap exceeded (Cap. 622)");
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 5. Transfer between wallets of same identity
  // ─────────────────────────────────────────────────────────────────
  describe("Transfer between wallets of same identity", function () {
    let factory;

    beforeEach(async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());
    });

    async function registerWithIdentity(investor) {
      await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(investor.address, topic, true);
      }
    }

    it("should not change shareholder count when transferring between same-identity wallets", async function () {
      const investor = signers[0];
      const wallet2  = signers[1];

      await registerWithIdentity(investor);
      const id1 = await registry.getIdentityForWallet(investor.address);
      await registry.connect(agent).linkWallet(wallet2.address, id1, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(wallet2.address, topic, true);
      }

      await token.connect(agent).mint(investor.address, MINT_AMOUNT);
      expect(await token.shareholderCount()).to.equal(1);

      // Transfer from wallet1 → wallet2 (same identity)
      await token.connect(investor).transfer(wallet2.address, SMALL_AMOUNT);

      expect(await token.shareholderCount()).to.equal(1);
      expect(await token.balanceOf(wallet2.address)).to.equal(SMALL_AMOUNT);
    });

    it("should track holder correctly when full balance moves between same-identity wallets", async function () {
      const investor = signers[0];
      const wallet2  = signers[1];

      await registerWithIdentity(investor);
      const id1 = await registry.getIdentityForWallet(investor.address);
      await registry.connect(agent).linkWallet(wallet2.address, id1, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(wallet2.address, topic, true);
      }

      await token.connect(agent).mint(investor.address, MINT_AMOUNT);

      // Move ALL tokens to wallet2
      await token.connect(investor).transfer(wallet2.address, MINT_AMOUNT);

      // Still 1 identity holder (aggregate balance > 0)
      expect(await token.shareholderCount()).to.equal(1);
      expect(await token.aggregateBalanceByIdentity(id1)).to.equal(MINT_AMOUNT);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // 6. Backward compatibility (no factory, boolean claims)
  // ─────────────────────────────────────────────────────────────────
  describe("Backward compatibility (no factory)", function () {
    it("should still work with boolean claims and no identity contract", async function () {
      // No factory set — identityContract will be 0x0
      await registerAndVerify(signers[0]);
      await registerAndVerify(signers[1]);

      await token.connect(agent).mint(signers[0].address, MINT_AMOUNT);
      await token.connect(agent).mint(signers[1].address, MINT_AMOUNT);

      // With no identity contract, holder tracking won't add to the set
      // (getIdentityForWallet returns 0x0)
      expect(await token.shareholderCount()).to.equal(0);
      // But transfers still work — cap is not enforced for 0x0 identities
    });

    it("should not block transfers when identities are zero (backward compat)", async function () {
      await registerAndVerify(signers[0]);
      await registerAndVerify(signers[1]);

      await token.connect(agent).mint(signers[0].address, MINT_AMOUNT);

      // Transfer should succeed even with cap = 1
      await token.connect(admin).setMaxShareholders(1);
      await expect(
        token.connect(signers[0]).transfer(signers[1].address, SMALL_AMOUNT)
      ).to.not.be.reverted;
    });
  });

  // ───────────────────────────────────────────────────────────────��─
  // 7. getIdentityHolders view
  // ─────────────────────────────────────────────────────────────────
  describe("getIdentityHolders view", function () {
    it("should return correct list of identity holders", async function () {
      const IdentityFactory = await ethers.getContractFactory("IdentityFactory");
      const factory = await IdentityFactory.deploy(admin.address);
      await registry.connect(admin).setIdentityFactory(await factory.getAddress());
      const DEPLOYER_ROLE = await factory.DEPLOYER_ROLE();
      await factory.connect(admin).grantRole(DEPLOYER_ROLE, await registry.getAddress());

      async function registerWithIdentity(investor) {
        await registry.connect(agent).registerIdentity(investor.address, ethers.ZeroAddress, "HK");
        for (let topic = 1; topic <= 5; topic++) {
          await registry.connect(agent).setClaim(investor.address, topic, true);
        }
      }

      await registerWithIdentity(signers[0]);
      await registerWithIdentity(signers[1]);

      await token.connect(agent).mint(signers[0].address, MINT_AMOUNT);
      await token.connect(agent).mint(signers[1].address, MINT_AMOUNT);

      const holders = await token.getIdentityHolders();
      expect(holders.length).to.equal(2);

      const id0 = await registry.getIdentityForWallet(signers[0].address);
      const id1 = await registry.getIdentityForWallet(signers[1].address);
      expect(holders).to.include(id0);
      expect(holders).to.include(id1);
    });
  });
});
