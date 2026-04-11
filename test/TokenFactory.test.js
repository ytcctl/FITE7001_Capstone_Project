const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenFactory", function () {
  let deployer, operator, investor;
  let identityRegistry, compliance, tokenFactory;

  beforeEach(async function () {
    [deployer, operator, investor] = await ethers.getSigners();

    // Deploy IdentityRegistry
    const IdentityRegistry = await ethers.getContractFactory("HKSTPIdentityRegistry");
    identityRegistry = await IdentityRegistry.deploy(deployer.address);
    await identityRegistry.waitForDeployment();

    // Deploy Compliance
    const Compliance = await ethers.getContractFactory("HKSTPCompliance");
    compliance = await Compliance.deploy(deployer.address, deployer.address);
    await compliance.waitForDeployment();

    // Deploy TokenFactory
    const TokenFactory = await ethers.getContractFactory("TokenFactory");
    tokenFactory = await TokenFactory.deploy(
      deployer.address,
      await identityRegistry.getAddress(),
      await compliance.getAddress()
    );
    await tokenFactory.waitForDeployment();

    // Grant DEFAULT_ADMIN_ROLE on Compliance to the TokenFactory
    // so it can call compliance.grantRole(TOKEN_ROLE, newToken)
    const adminRole = await compliance.DEFAULT_ADMIN_ROLE();
    await compliance.grantRole(adminRole, await tokenFactory.getAddress());
  });

  describe("Deployment", function () {
    it("should set the correct admin", async function () {
      const adminRole = await tokenFactory.DEFAULT_ADMIN_ROLE();
      expect(await tokenFactory.hasRole(adminRole, deployer.address)).to.be.true;
    });

    it("should set the correct identity registry", async function () {
      expect(await tokenFactory.identityRegistry()).to.equal(
        await identityRegistry.getAddress()
      );
    });

    it("should set the correct compliance", async function () {
      expect(await tokenFactory.compliance()).to.equal(
        await compliance.getAddress()
      );
    });

    it("should start with zero tokens", async function () {
      expect(await tokenFactory.tokenCount()).to.equal(0);
    });
  });

  describe("createToken", function () {
    it("should deploy a new security token", async function () {
      const tx = await tokenFactory.createToken(
        "TechStartup Alpha Token",
        "TSTA"
      );
      const receipt = await tx.wait();

      expect(await tokenFactory.tokenCount()).to.equal(1);

      const token = await tokenFactory.getToken(0);
      expect(token.name).to.equal("TechStartup Alpha Token");
      expect(token.symbol).to.equal("TSTA");
      expect(token.tokenAddress).to.not.equal(ethers.ZeroAddress);
      expect(token.createdBy).to.equal(deployer.address);
      expect(token.active).to.be.true;
    });

    it("should emit TokenCreated event", async function () {
      await expect(tokenFactory.createToken("Alpha Token", "ALPH"))
        .to.emit(tokenFactory, "TokenCreated")
        .withArgs(
          0,
          "Alpha Token",
          "ALPH",
          () => true, // any address
          deployer.address
        );
    });

    it("should grant TOKEN_ROLE on Compliance to the new token", async function () {
      await tokenFactory.createToken("Alpha Token", "ALPH");
      const token = await tokenFactory.getToken(0);

      const TOKEN_ROLE = await compliance.TOKEN_ROLE();
      expect(await compliance.hasRole(TOKEN_ROLE, token.tokenAddress)).to.be.true;
    });

    it("should make the caller admin + agent of the new token", async function () {
      await tokenFactory.createToken("Alpha Token", "ALPH");
      const tokenInfo = await tokenFactory.getToken(0);

      const HKSTPSecurityToken = await ethers.getContractFactory("HKSTPSecurityToken");
      const token = HKSTPSecurityToken.attach(tokenInfo.tokenAddress);

      const adminRole = await token.DEFAULT_ADMIN_ROLE();
      const agentRole = await token.AGENT_ROLE();

      expect(await token.hasRole(adminRole, deployer.address)).to.be.true;
      expect(await token.hasRole(agentRole, deployer.address)).to.be.true;
    });

    it("should link the token to the shared IdentityRegistry and Compliance", async function () {
      await tokenFactory.createToken("Alpha Token", "ALPH");
      const tokenInfo = await tokenFactory.getToken(0);

      const HKSTPSecurityToken = await ethers.getContractFactory("HKSTPSecurityToken");
      const token = HKSTPSecurityToken.attach(tokenInfo.tokenAddress);

      expect(await token.identityRegistry()).to.equal(
        await identityRegistry.getAddress()
      );
      expect(await token.compliance()).to.equal(
        await compliance.getAddress()
      );
    });

    it("should create multiple tokens", async function () {
      await tokenFactory.createToken("Alpha Token", "ALPH");
      await tokenFactory.createToken("Beta Token", "BETA");
      await tokenFactory.createToken("Gamma Token", "GAMM");

      expect(await tokenFactory.tokenCount()).to.equal(3);

      const all = await tokenFactory.allTokens();
      expect(all.length).to.equal(3);
      expect(all[0].symbol).to.equal("ALPH");
      expect(all[1].symbol).to.equal("BETA");
      expect(all[2].symbol).to.equal("GAMM");
    });

    it("should reject duplicate symbols", async function () {
      await tokenFactory.createToken("Alpha Token", "ALPH");
      await expect(
        tokenFactory.createToken("Another Alpha", "ALPH")
      ).to.be.revertedWithCustomError(tokenFactory, "SymbolAlreadyExists");
    });

    it("should reject empty name", async function () {
      await expect(
        tokenFactory.createToken("", "ALPH")
      ).to.be.revertedWithCustomError(tokenFactory, "EmptyNameOrSymbol");
    });

    it("should reject empty symbol", async function () {
      await expect(
        tokenFactory.createToken("Alpha Token", "")
      ).to.be.revertedWithCustomError(tokenFactory, "EmptyNameOrSymbol");
    });

    it("should reject non-admin callers", async function () {
      await expect(
        tokenFactory.connect(investor).createToken("Alpha Token", "ALPH")
      ).to.be.reverted;
    });
  });

  describe("getTokenBySymbol", function () {
    it("should return the correct token", async function () {
      await tokenFactory.createToken("Alpha Token", "ALPH");
      await tokenFactory.createToken("Beta Token", "BETA");

      const token = await tokenFactory.getTokenBySymbol("BETA");
      expect(token.name).to.equal("Beta Token");
      expect(token.symbol).to.equal("BETA");
    });

    it("should revert for unknown symbol", async function () {
      await expect(
        tokenFactory.getTokenBySymbol("UNKNOWN")
      ).to.be.revertedWith("TokenFactory: symbol not found");
    });
  });

  describe("deactivateToken / reactivateToken", function () {
    beforeEach(async function () {
      await tokenFactory.createToken("Alpha Token", "ALPH");
      await tokenFactory.createToken("Beta Token", "BETA");
    });

    it("should deactivate a token", async function () {
      await tokenFactory.deactivateToken(0);
      const token = await tokenFactory.getToken(0);
      expect(token.active).to.be.false;
    });

    it("should emit TokenDeactivated event", async function () {
      const token = await tokenFactory.getToken(0);
      await expect(tokenFactory.deactivateToken(0))
        .to.emit(tokenFactory, "TokenDeactivated")
        .withArgs(0, token.tokenAddress);
    });

    it("should reactivate a deactivated token", async function () {
      await tokenFactory.deactivateToken(0);
      await tokenFactory.reactivateToken(0);
      const token = await tokenFactory.getToken(0);
      expect(token.active).to.be.true;
    });

    it("should filter active tokens correctly", async function () {
      await tokenFactory.deactivateToken(0);

      const active = await tokenFactory.activeTokens();
      expect(active.length).to.equal(1);
      expect(active[0].symbol).to.equal("BETA");
    });

    it("should reject invalid index", async function () {
      await expect(
        tokenFactory.deactivateToken(99)
      ).to.be.revertedWithCustomError(tokenFactory, "InvalidIndex");
    });

    it("should reject non-admin callers", async function () {
      await expect(
        tokenFactory.connect(investor).deactivateToken(0)
      ).to.be.reverted;
    });
  });

  describe("setInfrastructure", function () {
    it("should update identity registry and compliance", async function () {
      const newAddr1 = ethers.Wallet.createRandom().address;
      const newAddr2 = ethers.Wallet.createRandom().address;

      await tokenFactory.setInfrastructure(newAddr1, newAddr2);
      expect(await tokenFactory.identityRegistry()).to.equal(newAddr1);
      expect(await tokenFactory.compliance()).to.equal(newAddr2);
    });

    it("should emit InfrastructureUpdated event", async function () {
      const newAddr1 = ethers.Wallet.createRandom().address;
      const newAddr2 = ethers.Wallet.createRandom().address;

      await expect(tokenFactory.setInfrastructure(newAddr1, newAddr2))
        .to.emit(tokenFactory, "InfrastructureUpdated")
        .withArgs(newAddr1, newAddr2);
    });

    it("should reject zero addresses", async function () {
      await expect(
        tokenFactory.setInfrastructure(ethers.ZeroAddress, ethers.ZeroAddress)
      ).to.be.revertedWith("zero addr");
    });

    it("should reject non-admin callers", async function () {
      const addr = ethers.Wallet.createRandom().address;
      await expect(
        tokenFactory.connect(investor).setInfrastructure(addr, addr)
      ).to.be.reverted;
    });
  });

  describe("Integration: mint tokens on factory-created token", function () {
    it("should allow admin to mint tokens on a factory-deployed token", async function () {
      await tokenFactory.createToken("Alpha Token", "ALPH");
      const tokenInfo = await tokenFactory.getToken(0);

      const HKSTPSecurityToken = await ethers.getContractFactory("HKSTPSecurityToken");
      const token = HKSTPSecurityToken.attach(tokenInfo.tokenAddress);

      // Register investor in the identity registry first
      const AGENT_ROLE = await identityRegistry.AGENT_ROLE();
      await identityRegistry.grantRole(AGENT_ROLE, deployer.address);
      await identityRegistry.registerIdentity(investor.address, ethers.ZeroAddress, "HK");

      // Set all 5 required claim topics (simple integers 1-5)
      for (let topic = 1; topic <= 5; topic++) {
        await identityRegistry.setClaim(investor.address, topic, true);
      }

      // Mint tokens
      await token.mint(investor.address, ethers.parseEther("1000"));
      expect(await token.balanceOf(investor.address)).to.equal(
        ethers.parseEther("1000")
      );
    });
  });

  describe("EIP-1167 Minimal Proxy", function () {
    it("should expose tokenImplementation address", async function () {
      const impl = await tokenFactory.tokenImplementation();
      expect(impl).to.not.equal(ethers.ZeroAddress);
    });

    it("should deploy clones at different addresses from implementation", async function () {
      const impl = await tokenFactory.tokenImplementation();
      await tokenFactory.createToken("Clone A", "CLA");
      const info = await tokenFactory.getToken(0);
      expect(info.tokenAddress).to.not.equal(impl);
    });

    it("should deploy clones at different addresses from each other", async function () {
      await tokenFactory.createToken("Clone A", "CLA");
      await tokenFactory.createToken("Clone B", "CLB");
      const a = await tokenFactory.getToken(0);
      const b = await tokenFactory.getToken(1);
      expect(a.tokenAddress).to.not.equal(b.tokenAddress);
    });

    it("each clone should have independent name/symbol", async function () {
      await tokenFactory.createToken("First Token", "FT");
      await tokenFactory.createToken("Second Token", "ST");

      const HKSTPSecurityToken = await ethers.getContractFactory("HKSTPSecurityToken");
      const t1 = HKSTPSecurityToken.attach((await tokenFactory.getToken(0)).tokenAddress);
      const t2 = HKSTPSecurityToken.attach((await tokenFactory.getToken(1)).tokenAddress);

      expect(await t1.name()).to.equal("First Token");
      expect(await t1.symbol()).to.equal("FT");
      expect(await t2.name()).to.equal("Second Token");
      expect(await t2.symbol()).to.equal("ST");
    });

    it("should revert initialize() on a factory-created clone (already initialised)", async function () {
      await tokenFactory.createToken("Clone", "CLN");
      const info = await tokenFactory.getToken(0);

      const HKSTPSecurityToken = await ethers.getContractFactory("HKSTPSecurityToken");
      const clone = HKSTPSecurityToken.attach(info.tokenAddress);

      await expect(
        clone.initialize("X", "X", await identityRegistry.getAddress(), await compliance.getAddress(), ethers.ZeroAddress, deployer.address)
      ).to.be.revertedWith("HKSTPSecurityToken: already initialized");
    });
  });
});
