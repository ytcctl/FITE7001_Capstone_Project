const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title HKSTPSecurityToken test suite
 *
 * Tests cover:
 *   - Token deployment and initialization
 *   - Minting by authorized agent
 *   - Transfer blocked when recipient not in Identity Registry
 *   - Transfer allowed when both parties are verified
 *   - Safe-list bypass for operational addresses
 *   - Pause/unpause functionality
 *   - Unauthorized minting rejection
 */
describe("HKSTPSecurityToken", function () {
  let token, registry, compliance;
  let admin, agent, treasury, alice, bob, charlie;

  const TOKEN_NAME    = "HKSTP Alpha Token";
  const TOKEN_SYMBOL  = "HKSAT";
  const MINT_AMOUNT   = ethers.parseUnits("1000", 18);
  const TRANSFER_AMOUNT = ethers.parseUnits("100", 18);

  beforeEach(async function () {
    [admin, agent, treasury, alice, bob, charlie] = await ethers.getSigners();

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
      ethers.ZeroAddress, // onchainId
      admin.address
    );

    // Grant AGENT_ROLE to agent account
    const AGENT_ROLE = await token.AGENT_ROLE();
    await token.connect(admin).grantRole(AGENT_ROLE, agent.address);

    // Register alice and bob with all 5 KYC claims
    const AGENT_ROLE_REG = await registry.AGENT_ROLE();
    await registry.connect(admin).grantRole(AGENT_ROLE_REG, agent.address);

    async function registerAndVerify(addr) {
      await registry.connect(agent).registerIdentity(addr, ethers.ZeroAddress, "HK");
      for (let topic = 1; topic <= 5; topic++) {
        await registry.connect(agent).setClaim(addr, topic, true);
      }
    }

    await registerAndVerify(alice.address);
    await registerAndVerify(bob.address);

    // Grant TOKEN_ROLE to the token contract so compliance.checkModules can be called
    const TOKEN_ROLE = await compliance.TOKEN_ROLE();
    await compliance.connect(admin).grantRole(TOKEN_ROLE, await token.getAddress());
  });

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  describe("Deployment", function () {
    it("should set the correct name and symbol", async function () {
      expect(await token.name()).to.equal(TOKEN_NAME);
      expect(await token.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("should link the correct identity registry", async function () {
      expect(await token.identityRegistry()).to.equal(await registry.getAddress());
    });

    it("should link the correct compliance contract", async function () {
      expect(await token.compliance()).to.equal(await compliance.getAddress());
    });

    it("should grant DEFAULT_ADMIN_ROLE and AGENT_ROLE to admin", async function () {
      const DEFAULT_ADMIN = await token.DEFAULT_ADMIN_ROLE();
      const AGENT_ROLE    = await token.AGENT_ROLE();
      expect(await token.hasRole(DEFAULT_ADMIN, admin.address)).to.be.true;
      expect(await token.hasRole(AGENT_ROLE, admin.address)).to.be.true;
    });

    it("should revert with zero identity registry address", async function () {
      const Token = await ethers.getContractFactory("HKSTPSecurityToken");
      await expect(
        Token.deploy(TOKEN_NAME, TOKEN_SYMBOL, ethers.ZeroAddress,
          await compliance.getAddress(), ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("HKSTPSecurityToken: zero registry");
    });
  });

  // ---------------------------------------------------------------------------
  // Minting
  // ---------------------------------------------------------------------------

  describe("Minting", function () {
    it("should allow agent to mint tokens to a verified investor", async function () {
      await token.connect(agent).mint(alice.address, MINT_AMOUNT);
      expect(await token.balanceOf(alice.address)).to.equal(MINT_AMOUNT);
    });

    it("should emit TokensMinted event", async function () {
      await expect(token.connect(agent).mint(alice.address, MINT_AMOUNT))
        .to.emit(token, "TokensMinted")
        .withArgs(alice.address, MINT_AMOUNT, agent.address);
    });

    it("should reject minting to unregistered address", async function () {
      await expect(
        token.connect(agent).mint(charlie.address, MINT_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: recipient not verified");
    });

    it("should reject minting by non-agent", async function () {
      await expect(
        token.connect(alice).mint(alice.address, MINT_AMOUNT)
      ).to.be.reverted;
    });

    it("should reject minting to frozen address", async function () {
      await token.connect(agent).setAddressFrozen(alice.address, true);
      await expect(
        token.connect(agent).mint(alice.address, MINT_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: recipient is frozen");
    });
  });

  // ---------------------------------------------------------------------------
  // Transfers
  // ---------------------------------------------------------------------------

  describe("Transfers", function () {
    beforeEach(async function () {
      await token.connect(agent).mint(alice.address, MINT_AMOUNT);
    });

    it("should allow transfer between two verified investors", async function () {
      await token.connect(alice).transfer(bob.address, TRANSFER_AMOUNT);
      expect(await token.balanceOf(bob.address)).to.equal(TRANSFER_AMOUNT);
    });

    it("should block transfer when recipient is not in Identity Registry", async function () {
      await expect(
        token.connect(alice).transfer(charlie.address, TRANSFER_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: recipient not verified");
    });

    it("should block transfer when sender is not verified", async function () {
      // Remove alice's KYC claim
      await registry.connect(agent).setClaim(alice.address, 1, false);
      await expect(
        token.connect(alice).transfer(bob.address, TRANSFER_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: sender not verified");
    });

    it("should block transfer when sender address is frozen", async function () {
      await token.connect(agent).setAddressFrozen(alice.address, true);
      await expect(
        token.connect(alice).transfer(bob.address, TRANSFER_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: sender is frozen");
    });

    it("should block transfer when recipient address is frozen", async function () {
      await token.connect(agent).setAddressFrozen(bob.address, true);
      await expect(
        token.connect(alice).transfer(bob.address, TRANSFER_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: recipient is frozen");
    });
  });

  // ---------------------------------------------------------------------------
  // Safe-list bypass
  // ---------------------------------------------------------------------------

  describe("Safe-list bypass", function () {
    beforeEach(async function () {
      // Safe-list treasury (not KYC-registered in identity registry)
      await token.connect(agent).setSafeList(treasury.address, true);
      await token.connect(agent).setSafeList(admin.address, true);
      // Mint directly to treasury by minting to alice first, then agent transfers
      await token.connect(agent).mint(alice.address, MINT_AMOUNT);
    });

    it("should emit SafeListUpdated on adding to safe-list", async function () {
      await expect(token.connect(agent).setSafeList(charlie.address, true))
        .to.emit(token, "SafeListUpdated")
        .withArgs(charlie.address, true);
    });

    it("should allow transfer between two safe-listed addresses", async function () {
      // admin is safe-listed, mint some tokens to admin by minting to alice then transferring
      // More direct: mint alice → alice transfers to treasury (treasury is safe-listed but alice is verified)
      // Actually we need BOTH to be safe-listed OR both to be verified.
      // Let's test: safe-listed sender → safe-listed recipient (bypasses compliance)
      await token.connect(agent).setSafeList(alice.address, true);
      await token.connect(alice).transfer(treasury.address, TRANSFER_AMOUNT);
      expect(await token.balanceOf(treasury.address)).to.equal(TRANSFER_AMOUNT);
    });

    it("should block transfer when only one side is safe-listed (other must be verified)", async function () {
      // treasury is safe-listed but alice is NOT safe-listed for this scenario
      // alice → treasury: alice is verified (not safe-listed), treasury is safe-listed but NOT verified
      // This should fail because treasury is not verified and not both are safe-listed
      await expect(
        token.connect(alice).transfer(treasury.address, TRANSFER_AMOUNT)
      ).to.be.revertedWith("HKSTPSecurityToken: recipient not verified");
    });
  });

  // ---------------------------------------------------------------------------
  // Burning
  // ---------------------------------------------------------------------------

  describe("Burning", function () {
    beforeEach(async function () {
      await token.connect(agent).mint(alice.address, MINT_AMOUNT);
    });

    it("should allow agent to burn tokens", async function () {
      await token.connect(agent).burn(alice.address, TRANSFER_AMOUNT);
      expect(await token.balanceOf(alice.address)).to.equal(MINT_AMOUNT - TRANSFER_AMOUNT);
    });

    it("should emit TokensBurned event", async function () {
      await expect(token.connect(agent).burn(alice.address, TRANSFER_AMOUNT))
        .to.emit(token, "TokensBurned")
        .withArgs(alice.address, TRANSFER_AMOUNT, agent.address);
    });

    it("should reject burn by non-agent", async function () {
      await expect(
        token.connect(alice).burn(alice.address, TRANSFER_AMOUNT)
      ).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // Pause / Unpause
  // ---------------------------------------------------------------------------

  describe("Pause and Unpause", function () {
    beforeEach(async function () {
      await token.connect(agent).mint(alice.address, MINT_AMOUNT);
    });

    it("should pause all transfers", async function () {
      await token.connect(admin).pause();
      await expect(
        token.connect(alice).transfer(bob.address, TRANSFER_AMOUNT)
      ).to.be.reverted;
    });

    it("should block minting when paused", async function () {
      await token.connect(admin).pause();
      await expect(
        token.connect(agent).mint(bob.address, TRANSFER_AMOUNT)
      ).to.be.reverted;
    });

    it("should allow transfers after unpause", async function () {
      await token.connect(admin).pause();
      await token.connect(admin).unpause();
      await token.connect(alice).transfer(bob.address, TRANSFER_AMOUNT);
      expect(await token.balanceOf(bob.address)).to.equal(TRANSFER_AMOUNT);
    });

    it("should reject pause from non-admin", async function () {
      await expect(token.connect(alice).pause()).to.be.reverted;
    });
  });

  // ---------------------------------------------------------------------------
  // EIP-1167 Minimal Proxy / Initialize
  // ---------------------------------------------------------------------------
  describe("EIP-1167 Minimal Proxy", function () {
    it("should support initialize() on a fresh (uninitialised) contract", async function () {
      const Token = await ethers.getContractFactory("HKSTPSecurityToken");
      // Deploy as implementation (admin=0 => skip init)
      const impl = await Token.deploy("", "", ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
      // Now initialize it
      await impl.initialize(
        "Proxy Token", "PTK",
        await registry.getAddress(),
        await compliance.getAddress(),
        ethers.ZeroAddress,
        admin.address
      );
      expect(await impl.name()).to.equal("Proxy Token");
      expect(await impl.symbol()).to.equal("PTK");
    });

    it("should revert double initialize()", async function () {
      const Token = await ethers.getContractFactory("HKSTPSecurityToken");
      const impl = await Token.deploy("", "", ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress);
      await impl.initialize(
        "P", "P",
        await registry.getAddress(),
        await compliance.getAddress(),
        ethers.ZeroAddress,
        admin.address
      );
      await expect(
        impl.initialize("X", "X", await registry.getAddress(), await compliance.getAddress(), ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("HKSTPSecurityToken: already initialized");
    });

    it("should revert initialize() on already-constructed token", async function () {
      await expect(
        token.initialize("X", "X", await registry.getAddress(), await compliance.getAddress(), ethers.ZeroAddress, admin.address)
      ).to.be.revertedWith("HKSTPSecurityToken: already initialized");
    });
  });

  // ---------------------------------------------------------------------------
  // ERC-1644 Forced Transfer
  // ---------------------------------------------------------------------------

  describe("ERC-1644 Forced Transfer", function () {
    const LEGAL_HASH = ethers.id("ipfs://QmCourtOrderCID_Cap32_S182");
    const OPERATOR_DATA = ethers.toUtf8Bytes("CASE-2026-001");

    beforeEach(async function () {
      // Mint tokens to alice (the "from" account)
      await token.connect(agent).mint(alice.address, MINT_AMOUNT);
    });

    it("should atomically transfer tokens from one address to another", async function () {
      await token.connect(agent).forcedTransfer(
        alice.address, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
      );
      expect(await token.balanceOf(alice.address)).to.equal(MINT_AMOUNT - TRANSFER_AMOUNT);
      expect(await token.balanceOf(bob.address)).to.equal(TRANSFER_AMOUNT);
    });

    it("should preserve totalSupply (burn+mint invariance)", async function () {
      const supplyBefore = await token.totalSupply();
      await token.connect(agent).forcedTransfer(
        alice.address, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
      );
      expect(await token.totalSupply()).to.equal(supplyBefore);
    });

    it("should emit ForcedTransfer event with legal hash and operator data", async function () {
      await expect(
        token.connect(agent).forcedTransfer(
          alice.address, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
        )
      ).to.emit(token, "ForcedTransfer")
        .withArgs(
          agent.address,
          alice.address,
          bob.address,
          TRANSFER_AMOUNT,
          LEGAL_HASH,
          ethers.hexlify(OPERATOR_DATA)
        );
    });

    it("should work even when 'from' is frozen (court order overrides)", async function () {
      await token.connect(agent).setAddressFrozen(alice.address, true);
      // Normal transfer would revert, but forcedTransfer bypasses freeze
      await token.connect(agent).forcedTransfer(
        alice.address, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
      );
      expect(await token.balanceOf(bob.address)).to.equal(TRANSFER_AMOUNT);
    });

    it("should revert when 'to' is not verified in Identity Registry", async function () {
      await expect(
        token.connect(agent).forcedTransfer(
          alice.address, charlie.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
        )
      ).to.be.revertedWith("HKSTPSecurityToken: recipient not verified");
    });

    it("should revert when called by non-agent", async function () {
      await expect(
        token.connect(alice).forcedTransfer(
          alice.address, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
        )
      ).to.be.reverted;
    });

    it("should revert with zero legal order hash", async function () {
      await expect(
        token.connect(agent).forcedTransfer(
          alice.address, bob.address, TRANSFER_AMOUNT, ethers.ZeroHash, OPERATOR_DATA
        )
      ).to.be.revertedWith("HKSTPSecurityToken: missing legal order hash");
    });

    it("should revert with zero amount", async function () {
      await expect(
        token.connect(agent).forcedTransfer(
          alice.address, bob.address, 0, LEGAL_HASH, OPERATOR_DATA
        )
      ).to.be.revertedWith("HKSTPSecurityToken: zero amount");
    });

    it("should revert when 'from' has insufficient balance", async function () {
      const tooMuch = MINT_AMOUNT + 1n;
      await expect(
        token.connect(agent).forcedTransfer(
          alice.address, bob.address, tooMuch, LEGAL_HASH, OPERATOR_DATA
        )
      ).to.be.revertedWith("HKSTPSecurityToken: insufficient balance");
    });

    it("should revert with zero 'from' address", async function () {
      await expect(
        token.connect(agent).forcedTransfer(
          ethers.ZeroAddress, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
        )
      ).to.be.revertedWith("HKSTPSecurityToken: from is zero address");
    });

    it("should revert with zero 'to' address", async function () {
      await expect(
        token.connect(agent).forcedTransfer(
          alice.address, ethers.ZeroAddress, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
        )
      ).to.be.revertedWith("HKSTPSecurityToken: to is zero address");
    });

    it("should revert when contract is paused", async function () {
      await token.connect(admin).pause();
      await expect(
        token.connect(agent).forcedTransfer(
          alice.address, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
        )
      ).to.be.reverted;
    });

    it("should accept empty operatorData", async function () {
      await token.connect(agent).forcedTransfer(
        alice.address, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, "0x"
      );
      expect(await token.balanceOf(bob.address)).to.equal(TRANSFER_AMOUNT);
    });

    it("should restore safe-list status after forced transfer", async function () {
      // Verify alice and bob are NOT safe-listed before
      expect(await token.safeListed(alice.address)).to.be.false;
      expect(await token.safeListed(bob.address)).to.be.false;

      await token.connect(agent).forcedTransfer(
        alice.address, bob.address, TRANSFER_AMOUNT, LEGAL_HASH, OPERATOR_DATA
      );

      // Safe-list status should be restored to original (false)
      expect(await token.safeListed(alice.address)).to.be.false;
      expect(await token.safeListed(bob.address)).to.be.false;
    });

    it("isControllable() should return true", async function () {
      expect(await token.isControllable()).to.be.true;
    });
  });
});
