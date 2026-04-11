const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title Batch Settlement & TokenFactoryV2 & SystemHealthCheck test suite
 *
 * Tests:
 *   - executeBatchSettlement (happy path, partial failure, max cap)
 *   - TokenFactoryV2 (create token via proxy, deactivate, upgrade)
 *   - SystemHealthCheck (full health check)
 */
describe("Action Plan — New Features", function () {

  // ═══════════════════════════════════════════════════════════════
  // Batch Settlement
  // ═══════════════════════════════════════════════════════════════
  describe("DvPSettlement — executeBatchSettlement", function () {
    let dvp, securityToken, cashToken, registry, compliance;
    let admin, operator, agent, seller, buyer;

    const SEC_AMT  = ethers.parseUnits("100", 18);
    const CASH_AMT = ethers.parseUnits("5000", 6);

    async function getDeadline(offset = 3600) {
      const b = await ethers.provider.getBlock("latest");
      return b.timestamp + offset;
    }

    beforeEach(async function () {
      [admin, operator, agent, seller, buyer] = await ethers.getSigners();

      const Registry = await ethers.getContractFactory("HKSTPIdentityRegistry");
      registry = await Registry.deploy(admin.address);

      const Compliance = await ethers.getContractFactory("HKSTPCompliance");
      compliance = await Compliance.deploy(admin.address, admin.address);

      const Token = await ethers.getContractFactory("HKSTPSecurityToken");
      securityToken = await Token.deploy(
        "Test Token", "TST",
        await registry.getAddress(), await compliance.getAddress(),
        ethers.ZeroAddress, admin.address
      );

      const MockCash = await ethers.getContractFactory("MockCashToken");
      cashToken = await MockCash.deploy("Cash", "THKD", 6, admin.address);

      const DvP = await ethers.getContractFactory("DvPSettlement");
      dvp = await DvP.deploy(admin.address);

      // Roles
      await dvp.connect(admin).grantRole(await dvp.OPERATOR_ROLE(), operator.address);
      await securityToken.connect(admin).grantRole(await securityToken.AGENT_ROLE(), agent.address);
      await registry.connect(admin).grantRole(await registry.AGENT_ROLE(), agent.address);
      await compliance.connect(admin).grantRole(await compliance.TOKEN_ROLE(), await securityToken.getAddress());

      // Register & verify
      for (const addr of [seller.address, buyer.address]) {
        await registry.connect(agent).registerIdentity(addr, ethers.ZeroAddress, "HK");
        for (let t = 1; t <= 5; t++) await registry.connect(agent).setClaim(addr, t, true);
      }

      // Mint
      await securityToken.connect(agent).mint(seller.address, SEC_AMT * 5n); // enough for 5 settlements
      await cashToken.connect(admin).mint(buyer.address, CASH_AMT * 5n);

      // Approvals
      await securityToken.connect(seller).approve(await dvp.getAddress(), SEC_AMT * 5n);
      await cashToken.connect(buyer).approve(await dvp.getAddress(), CASH_AMT * 5n);
    });

    it("should execute a batch of settlements", async function () {
      const deadline = await getDeadline();
      const dvpAddr = await dvp.getAddress();
      const secAddr = await securityToken.getAddress();
      const cashAddr = await cashToken.getAddress();
      const matchId = ethers.keccak256(ethers.toUtf8Bytes("BATCH_1"));

      // Create 3 settlements
      for (let i = 0; i < 3; i++) {
        await dvp.connect(operator).createSettlement(
          seller.address, buyer.address,
          secAddr, SEC_AMT,
          cashAddr, CASH_AMT,
          deadline, matchId
        );
      }

      // Execute batch
      const tx = await dvp.connect(operator).executeBatchSettlement([0, 1, 2], false);
      await expect(tx).to.emit(dvp, "BatchSettlementExecuted");

      // All should be settled (status 1)
      for (let i = 0; i < 3; i++) {
        const s = await dvp.getSettlement(i);
        expect(s.status).to.equal(1); // Settled
      }
    });

    it("should emit SettlementExecuted for each in batch", async function () {
      const deadline = await getDeadline();
      const secAddr = await securityToken.getAddress();
      const cashAddr = await cashToken.getAddress();
      const matchId = ethers.keccak256(ethers.toUtf8Bytes("BATCH_2"));

      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address, secAddr, SEC_AMT,
        cashAddr, CASH_AMT, deadline, matchId
      );

      const tx = await dvp.connect(operator).executeBatchSettlement([0], false);
      await expect(tx).to.emit(dvp, "SettlementExecuted");
    });

    it("should revert with empty array", async function () {
      await expect(
        dvp.connect(operator).executeBatchSettlement([], false)
      ).to.be.revertedWith("DvPSettlement: empty batch");
    });

    it("should revert with more than 50 items", async function () {
      const ids = Array.from({ length: 51 }, (_, i) => i);
      await expect(
        dvp.connect(operator).executeBatchSettlement(ids, false)
      ).to.be.revertedWith("DvPSettlement: batch too large");
    });

    it("should reject batch from non-operator", async function () {
      await expect(
        dvp.connect(seller).executeBatchSettlement([0], false)
      ).to.be.reverted;
    });

    it("should skip failed settlements when stopOnFailure is false", async function () {
      const deadline = await getDeadline();
      const secAddr = await securityToken.getAddress();
      const cashAddr = await cashToken.getAddress();
      const matchId = ethers.keccak256(ethers.toUtf8Bytes("BATCH_3"));

      // Create 2 settlements
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address, secAddr, SEC_AMT,
        cashAddr, CASH_AMT, deadline, matchId
      );
      await dvp.connect(operator).createSettlement(
        seller.address, buyer.address, secAddr, SEC_AMT,
        cashAddr, CASH_AMT, deadline, matchId
      );

      // Execute first one manually so it becomes Settled
      await dvp.connect(operator).executeSettlement(0);

      // Now batch [0, 1] — 0 will skip (already settled), 1 should succeed
      const tx = await dvp.connect(operator).executeBatchSettlement([0, 1], false);
      await expect(tx).to.emit(dvp, "BatchSettlementExecuted");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TokenFactoryV2
  // ═══════════════════════════════════════════════════════════════
  describe("TokenFactoryV2 — Upgradeable Proxy Factory", function () {
    let factoryV2, registry, compliance, implementation;
    let admin, outsider;

    beforeEach(async function () {
      [admin, outsider] = await ethers.getSigners();

      const Registry = await ethers.getContractFactory("HKSTPIdentityRegistry");
      registry = await Registry.deploy(admin.address);

      const Compliance = await ethers.getContractFactory("HKSTPCompliance");
      compliance = await Compliance.deploy(admin.address, admin.address);

      // Deploy a token implementation
      const Token = await ethers.getContractFactory("HKSTPSecurityToken");
      implementation = await Token.deploy(
        "Impl", "IMPL",
        await registry.getAddress(), await compliance.getAddress(),
        ethers.ZeroAddress, admin.address
      );

      // Grant TOKEN_ROLE on compliance to admin (factory calls grantRole)
      await compliance.connect(admin).grantRole(
        await compliance.TOKEN_ROLE(),
        admin.address
      );

      const FactoryV2 = await ethers.getContractFactory("TokenFactoryV2");
      factoryV2 = await FactoryV2.deploy(
        admin.address,
        await registry.getAddress(),
        await compliance.getAddress(),
        await implementation.getAddress()
      );

      // Grant TOKEN_ROLE admin on compliance to factoryV2 so it can grantRole to proxies
      const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
      await compliance.connect(admin).grantRole(DEFAULT_ADMIN_ROLE, await factoryV2.getAddress());
    });

    it("should set correct infrastructure addresses", async function () {
      expect(await factoryV2.identityRegistry()).to.equal(await registry.getAddress());
      expect(await factoryV2.compliance()).to.equal(await compliance.getAddress());
      expect(await factoryV2.currentImplementation()).to.equal(await implementation.getAddress());
    });

    it("should start with zero tokens", async function () {
      expect(await factoryV2.tokenCount()).to.equal(0);
    });

    it("should create a token behind an ERC-1967 proxy", async function () {
      const tx = await factoryV2.connect(admin).createToken("Alpha Fund", "ALPHA");
      await expect(tx).to.emit(factoryV2, "TokenCreated");

      expect(await factoryV2.tokenCount()).to.equal(1);
      expect(await factoryV2.deployedProxyCount()).to.equal(1);

      const token = await factoryV2.getToken(0);
      expect(token.name).to.equal("Alpha Fund");
      expect(token.symbol).to.equal("ALPHA");
      expect(token.active).to.be.true;
      expect(token.proxyAddress).to.not.equal(ethers.ZeroAddress);
    });

    it("should reject duplicate symbol", async function () {
      await factoryV2.connect(admin).createToken("Alpha", "ALPHA");
      await expect(
        factoryV2.connect(admin).createToken("Alpha 2", "ALPHA")
      ).to.be.revertedWithCustomError(factoryV2, "SymbolAlreadyExists");
    });

    it("should reject empty name or symbol", async function () {
      await expect(
        factoryV2.connect(admin).createToken("", "ALPHA")
      ).to.be.revertedWithCustomError(factoryV2, "EmptyNameOrSymbol");

      await expect(
        factoryV2.connect(admin).createToken("Alpha", "")
      ).to.be.revertedWithCustomError(factoryV2, "EmptyNameOrSymbol");
    });

    it("should reject non-admin caller", async function () {
      await expect(
        factoryV2.connect(outsider).createToken("X", "X")
      ).to.be.reverted;
    });

    it("should deactivate and reactivate a token", async function () {
      await factoryV2.connect(admin).createToken("Beta", "BETA");

      await expect(factoryV2.connect(admin).deactivateToken(0))
        .to.emit(factoryV2, "TokenDeactivated");

      let token = await factoryV2.getToken(0);
      expect(token.active).to.be.false;

      await expect(factoryV2.connect(admin).reactivateToken(0))
        .to.emit(factoryV2, "TokenReactivated");

      token = await factoryV2.getToken(0);
      expect(token.active).to.be.true;
    });

    it("should return token by symbol", async function () {
      await factoryV2.connect(admin).createToken("Gamma", "GAMMA");
      const token = await factoryV2.getTokenBySymbol("GAMMA");
      expect(token.name).to.equal("Gamma");
    });

    it("should update infrastructure addresses", async function () {
      const newReg = admin.address; // just a placeholder
      const newComp = admin.address;
      await expect(
        factoryV2.connect(admin).setInfrastructure(newReg, newComp)
      ).to.emit(factoryV2, "InfrastructureUpdated");
    });

    it("should revert constructor with zero addresses", async function () {
      const F = await ethers.getContractFactory("TokenFactoryV2");
      await expect(
        F.deploy(ethers.ZeroAddress, admin.address, admin.address, admin.address)
      ).to.be.revertedWith("TokenFactoryV2: zero admin");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // SystemHealthCheck
  // ═══════════════════════════════════════════════════════════════
  describe("SystemHealthCheck", function () {
    let healthCheck, registry, compliance, securityToken, cashToken, dvp;
    let admin, agent;

    beforeEach(async function () {
      [admin, agent] = await ethers.getSigners();

      const Registry = await ethers.getContractFactory("HKSTPIdentityRegistry");
      registry = await Registry.deploy(admin.address);

      const Compliance = await ethers.getContractFactory("HKSTPCompliance");
      compliance = await Compliance.deploy(admin.address, admin.address);

      const Token = await ethers.getContractFactory("HKSTPSecurityToken");
      securityToken = await Token.deploy(
        "Test Token", "TST",
        await registry.getAddress(), await compliance.getAddress(),
        ethers.ZeroAddress, admin.address
      );

      const MockCash = await ethers.getContractFactory("MockCashToken");
      cashToken = await MockCash.deploy("Cash", "THKD", 6, admin.address);

      const DvP = await ethers.getContractFactory("DvPSettlement");
      dvp = await DvP.deploy(admin.address);

      // Grant roles
      await dvp.connect(admin).grantRole(await dvp.OPERATOR_ROLE(), admin.address);
      await dvp.connect(admin).grantRole(await dvp.PAUSER_ROLE(), admin.address);
      await securityToken.connect(admin).grantRole(await securityToken.AGENT_ROLE(), agent.address);
      await registry.connect(admin).grantRole(await registry.AGENT_ROLE(), agent.address);
      await compliance.connect(admin).grantRole(await compliance.TOKEN_ROLE(), await securityToken.getAddress());

      // Mint some tokens so supply checks pass
      await registry.connect(agent).registerIdentity(agent.address, ethers.ZeroAddress, "HK");
      for (let t = 1; t <= 5; t++) await registry.connect(agent).setClaim(agent.address, t, true);
      await securityToken.connect(agent).mint(agent.address, ethers.parseUnits("1000", 18));
      await cashToken.connect(admin).mint(admin.address, ethers.parseUnits("1000", 6));

      const HC = await ethers.getContractFactory("SystemHealthCheck");
      healthCheck = await HC.deploy();
    });

    it("should run full health check and report results", async function () {
      const addresses = {
        identityRegistry: await registry.getAddress(),
        compliance:       await compliance.getAddress(),
        securityToken:    await securityToken.getAddress(),
        cashToken:        await cashToken.getAddress(),
        dvpSettlement:    await dvp.getAddress(),
        tokenFactory:     ethers.ZeroAddress,        // no factory in this test
        identityFactory:  ethers.ZeroAddress,        // no factory
        governor:         ethers.ZeroAddress,        // no governor
        timelock:         ethers.ZeroAddress,        // no timelock
        walletRegistry:   ethers.ZeroAddress,        // no wallet registry
        multiSigWarm:     ethers.ZeroAddress,        // no multi-sig
        expectedAdmin:    admin.address,
      };

      const [report, results] = await healthCheck.fullHealthCheck(addresses);

      expect(report.totalChecks).to.equal(20);
      // Some will pass, some won't (we didn't deploy all contracts)
      expect(report.passedChecks).to.be.greaterThan(0);
      expect(results.length).to.equal(20);

      // Token -> IdentityRegistry should pass
      expect(results[0].passed).to.be.true;
      expect(results[0].name).to.equal("Token -> IdentityRegistry wiring");

      // Token -> Compliance should pass
      expect(results[1].passed).to.be.true;
    });

    it("should detect missing admin on zero-address contracts", async function () {
      const addresses = {
        identityRegistry: ethers.ZeroAddress,
        compliance:       ethers.ZeroAddress,
        securityToken:    ethers.ZeroAddress,
        cashToken:        ethers.ZeroAddress,
        dvpSettlement:    ethers.ZeroAddress,
        tokenFactory:     ethers.ZeroAddress,
        identityFactory:  ethers.ZeroAddress,
        governor:         ethers.ZeroAddress,
        timelock:         ethers.ZeroAddress,
        walletRegistry:   ethers.ZeroAddress,
        multiSigWarm:     ethers.ZeroAddress,
        expectedAdmin:    admin.address,
      };

      const [report] = await healthCheck.fullHealthCheck(addresses);
      expect(report.healthy).to.be.false;
      expect(report.failedChecks).to.be.greaterThan(0);
    });
  });
});
