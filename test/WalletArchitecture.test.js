const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title WalletArchitecture test suite
 *
 * Covers:
 *   - WalletRegistry: tier classification, hot cap, cold restrictions, sweep
 *   - MultiSigWarm: 2-of-3 multi-sig lifecycle, expiry, cancellation
 *   - Integration: end-to-end rebalancing flow
 */
describe("Wallet Architecture (98/2 Rule)", function () {
  let walletRegistry, multiSig, mockToken, mockCash;
  let admin, operator, signer1, signer2, signer3, hotWallet, warmWallet, coldWallet, outsider;

  const MINT_AMOUNT = ethers.parseUnits("1000000", 18); // 1M tokens
  const HOT_AMOUNT = ethers.parseUnits("15000", 18);    // 1.5% — within cap
  const WARM_AMOUNT = ethers.parseUnits("50000", 18);   // 5%
  const COLD_AMOUNT = ethers.parseUnits("935000", 18);  // 93.5%

  // Wallet tiers (enum values)
  const UNREGISTERED = 0;
  const HOT = 1;
  const WARM = 2;
  const COLD = 3;

  /** Helper: mine N blocks */
  async function mineBlocks(n) {
    for (let i = 0; i < n; i++) {
      await ethers.provider.send("evm_mine", []);
    }
  }

  beforeEach(async function () {
    [admin, operator, signer1, signer2, signer3, hotWallet, warmWallet, coldWallet, outsider] =
      await ethers.getSigners();

    // Deploy mock ERC-20 tokens
    const MockCash = await ethers.getContractFactory("MockCashToken");
    mockToken = await MockCash.deploy("Security Token", "HKST", 18, admin.address);
    mockCash = await MockCash.deploy("Cash Token", "THKD", 18, admin.address);

    // Deploy WalletRegistry
    const WalletRegistry = await ethers.getContractFactory("WalletRegistry");
    walletRegistry = await WalletRegistry.deploy(admin.address);

    // Deploy MultiSigWarm (3 signers)
    const MultiSigWarm = await ethers.getContractFactory("MultiSigWarm");
    multiSig = await MultiSigWarm.deploy([signer1.address, signer2.address, signer3.address]);

    // Grant OPERATOR_ROLE
    const OPERATOR_ROLE = await walletRegistry.OPERATOR_ROLE();
    await walletRegistry.connect(admin).grantRole(OPERATOR_ROLE, operator.address);
  });

  // =========================================================================
  // WalletRegistry — Tier Classification
  // =========================================================================
  describe("WalletRegistry — Tier Classification", function () {
    it("should register wallets with correct tiers", async function () {
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-FPS-1");
      await walletRegistry.connect(admin).registerWallet(warmWallet.address, WARM, "Warm-Buffer");
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-HSM-1");

      const hotInfo = await walletRegistry.wallets(hotWallet.address);
      expect(hotInfo.tier).to.equal(HOT);
      expect(hotInfo.label).to.equal("Hot-FPS-1");
      expect(hotInfo.active).to.be.true;

      const warmInfo = await walletRegistry.wallets(warmWallet.address);
      expect(warmInfo.tier).to.equal(WARM);

      const coldInfo = await walletRegistry.wallets(coldWallet.address);
      expect(coldInfo.tier).to.equal(COLD);
    });

    it("should reject duplicate wallet registration", async function () {
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-1");
      await expect(
        walletRegistry.connect(admin).registerWallet(hotWallet.address, WARM, "Warm-1")
      ).to.be.revertedWith("WalletRegistry: already registered");
    });

    it("should reject UNREGISTERED tier", async function () {
      await expect(
        walletRegistry.connect(admin).registerWallet(hotWallet.address, UNREGISTERED, "Bad")
      ).to.be.revertedWith("WalletRegistry: invalid tier");
    });

    it("should reject zero address", async function () {
      await expect(
        walletRegistry.connect(admin).registerWallet(ethers.ZeroAddress, HOT, "Bad")
      ).to.be.revertedWith("WalletRegistry: zero address");
    });

    it("should restrict registration to DEFAULT_ADMIN_ROLE", async function () {
      await expect(
        walletRegistry.connect(outsider).registerWallet(hotWallet.address, HOT, "Bad")
      ).to.be.reverted;
    });

    it("should return correct wallet count", async function () {
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-1");
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-1");
      expect(await walletRegistry.walletCount()).to.equal(2);
    });

    it("should return wallets by tier", async function () {
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-1");
      await walletRegistry.connect(admin).registerWallet(warmWallet.address, WARM, "Warm-1");
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-1");

      const hotWallets = await walletRegistry.getWalletsByTier(HOT);
      expect(hotWallets.length).to.equal(1);
      expect(hotWallets[0]).to.equal(hotWallet.address);

      const coldWallets = await walletRegistry.getWalletsByTier(COLD);
      expect(coldWallets.length).to.equal(1);
      expect(coldWallets[0]).to.equal(coldWallet.address);
    });

    it("should deactivate and reactivate wallets", async function () {
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-1");
      await walletRegistry.connect(admin).deactivateWallet(hotWallet.address);

      const info = await walletRegistry.wallets(hotWallet.address);
      expect(info.active).to.be.false;

      // Deactivated wallet excluded from tier queries
      const hotWallets = await walletRegistry.getWalletsByTier(HOT);
      expect(hotWallets.length).to.equal(0);

      // Reactivate
      await walletRegistry.connect(admin).reactivateWallet(hotWallet.address);
      const reactivated = await walletRegistry.wallets(hotWallet.address);
      expect(reactivated.active).to.be.true;
    });

    it("should change wallet tier", async function () {
      await walletRegistry.connect(admin).registerWallet(warmWallet.address, WARM, "Warm-1");
      await walletRegistry.connect(admin).changeWalletTier(warmWallet.address, HOT);

      const info = await walletRegistry.wallets(warmWallet.address);
      expect(info.tier).to.equal(HOT);
    });
  });

  // =========================================================================
  // WalletRegistry — Token Tracking & AUM
  // =========================================================================
  describe("WalletRegistry — Token Tracking & AUM", function () {
    beforeEach(async function () {
      // Register wallets
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-1");
      await walletRegistry.connect(admin).registerWallet(warmWallet.address, WARM, "Warm-1");
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-1");

      // Track the token
      await walletRegistry.connect(admin).addTrackedToken(await mockToken.getAddress());

      // Distribute tokens
      await mockToken.connect(admin).mint(hotWallet.address, HOT_AMOUNT);
      await mockToken.connect(admin).mint(warmWallet.address, WARM_AMOUNT);
      await mockToken.connect(admin).mint(coldWallet.address, COLD_AMOUNT);
    });

    it("should calculate correct totalAUM", async function () {
      const aum = await walletRegistry.totalAUM(await mockToken.getAddress());
      expect(aum).to.equal(HOT_AMOUNT + WARM_AMOUNT + COLD_AMOUNT);
    });

    it("should calculate correct tier balances", async function () {
      const tokenAddr = await mockToken.getAddress();
      expect(await walletRegistry.hotBalance(tokenAddr)).to.equal(HOT_AMOUNT);
      expect(await walletRegistry.warmBalance(tokenAddr)).to.equal(WARM_AMOUNT);
      expect(await walletRegistry.coldBalance(tokenAddr)).to.equal(COLD_AMOUNT);
    });

    it("should return correct tier breakdown", async function () {
      const tokenAddr = await mockToken.getAddress();
      const [hotBal, warmBal, coldBal, total, capVal, overCap] =
        await walletRegistry.tierBreakdown(tokenAddr);

      expect(hotBal).to.equal(HOT_AMOUNT);
      expect(warmBal).to.equal(WARM_AMOUNT);
      expect(coldBal).to.equal(COLD_AMOUNT);
      expect(total).to.equal(MINT_AMOUNT);
      // 2% of 1M = 20000 tokens
      expect(capVal).to.equal(ethers.parseUnits("20000", 18));
      // Hot balance is 15000 < 20000 cap → not over
      expect(overCap).to.be.false;
    });

    it("should add and remove tracked tokens", async function () {
      const cashAddr = await mockCash.getAddress();
      await walletRegistry.connect(admin).addTrackedToken(cashAddr);
      expect(await walletRegistry.isTrackedToken(cashAddr)).to.be.true;

      const tokens = await walletRegistry.getTrackedTokens();
      expect(tokens.length).to.equal(2);

      await walletRegistry.connect(admin).removeTrackedToken(cashAddr);
      expect(await walletRegistry.isTrackedToken(cashAddr)).to.be.false;
    });

    it("should reject duplicate token tracking", async function () {
      await expect(
        walletRegistry.connect(admin).addTrackedToken(await mockToken.getAddress())
      ).to.be.revertedWith("WalletRegistry: already tracked");
    });
  });

  // =========================================================================
  // WalletRegistry — Hot Cap Enforcement (98/2 Rule)
  // =========================================================================
  describe("WalletRegistry — Hot Cap Enforcement", function () {
    beforeEach(async function () {
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-1");
      await walletRegistry.connect(admin).registerWallet(warmWallet.address, WARM, "Warm-1");
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-1");
      await walletRegistry.connect(admin).addTrackedToken(await mockToken.getAddress());
    });

    it("should report default hot cap as 200 bps (2%)", async function () {
      expect(await walletRegistry.hotCapBps()).to.equal(200);
    });

    it("should report not over cap when hot < 2%", async function () {
      await mockToken.connect(admin).mint(hotWallet.address, ethers.parseUnits("1000", 18));
      await mockToken.connect(admin).mint(coldWallet.address, ethers.parseUnits("99000", 18));

      // Hot = 1000 / 100000 = 1% < 2%
      expect(await walletRegistry.isHotOverCap(await mockToken.getAddress())).to.be.false;
    });

    it("should report over cap when hot > 2%", async function () {
      await mockToken.connect(admin).mint(hotWallet.address, ethers.parseUnits("30000", 18));
      await mockToken.connect(admin).mint(coldWallet.address, ethers.parseUnits("70000", 18));

      // Hot = 30000 / 100000 = 30% > 2%
      expect(await walletRegistry.isHotOverCap(await mockToken.getAddress())).to.be.true;
    });

    it("should calculate correct hot cap value", async function () {
      await mockToken.connect(admin).mint(hotWallet.address, ethers.parseUnits("10000", 18));
      await mockToken.connect(admin).mint(coldWallet.address, ethers.parseUnits("90000", 18));

      // AUM = 100000, cap = 2% = 2000
      expect(await walletRegistry.hotCap(await mockToken.getAddress()))
        .to.equal(ethers.parseUnits("2000", 18));
    });

    it("should allow admin to update hot cap", async function () {
      await walletRegistry.connect(admin).setHotCapBps(300); // 3%
      expect(await walletRegistry.hotCapBps()).to.equal(300);
    });

    it("should reject hot cap > 100%", async function () {
      await expect(
        walletRegistry.connect(admin).setHotCapBps(10001)
      ).to.be.revertedWith("WalletRegistry: cap > 100%");
    });

    it("should emit SweepRequired when hot over cap", async function () {
      const tokenAddr = await mockToken.getAddress();
      await mockToken.connect(admin).mint(hotWallet.address, ethers.parseUnits("50000", 18));
      await mockToken.connect(admin).mint(coldWallet.address, ethers.parseUnits("50000", 18));

      // Hot = 50000 / 100000 = 50% > 2%
      // Cap = 2000, excess = 48000
      await expect(walletRegistry.checkAndEmitSweep())
        .to.emit(walletRegistry, "SweepRequired")
        .withArgs(
          tokenAddr,
          ethers.parseUnits("50000", 18),
          ethers.parseUnits("2000", 18),
          ethers.parseUnits("48000", 18)
        );
    });
  });

  // =========================================================================
  // WalletRegistry — Cold Wallet Transfer Restrictions
  // =========================================================================
  describe("WalletRegistry — Cold Wallet Restrictions", function () {
    beforeEach(async function () {
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-1");
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-1");
    });

    it("should block transfers from cold wallets", async function () {
      const [allowed, reason] = await walletRegistry.canTransferFrom(coldWallet.address);
      expect(allowed).to.be.false;
      expect(reason).to.equal("WalletRegistry: cold wallet transfers blocked");
    });

    it("should allow transfers from hot wallets", async function () {
      const [allowed] = await walletRegistry.canTransferFrom(hotWallet.address);
      expect(allowed).to.be.true;
    });

    it("should allow transfers from unregistered addresses", async function () {
      const [allowed] = await walletRegistry.canTransferFrom(outsider.address);
      expect(allowed).to.be.true;
    });
  });

  // =========================================================================
  // WalletRegistry — Sweep Audit Trail
  // =========================================================================
  describe("WalletRegistry — Sweep Audit Trail", function () {
    beforeEach(async function () {
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-1");
      await walletRegistry.connect(admin).registerWallet(warmWallet.address, WARM, "Warm-1");
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-1");
      await walletRegistry.connect(admin).addTrackedToken(await mockToken.getAddress());
    });

    it("should record sweep operations", async function () {
      const tokenAddr = await mockToken.getAddress();
      const sweepAmount = ethers.parseUnits("10000", 18);

      await expect(
        walletRegistry.connect(operator).recordSweep(
          tokenAddr, hotWallet.address, coldWallet.address, sweepAmount, "auto-sweep"
        )
      ).to.emit(walletRegistry, "SweepExecuted");

      expect(await walletRegistry.sweepCount()).to.equal(1);

      const record = await walletRegistry.sweepHistory(0);
      expect(record.token).to.equal(tokenAddr);
      expect(record.from).to.equal(hotWallet.address);
      expect(record.to).to.equal(coldWallet.address);
      expect(record.amount).to.equal(sweepAmount);
      expect(record.reason).to.equal("auto-sweep");
    });

    it("should reject sweep from non-operator", async function () {
      await expect(
        walletRegistry.connect(outsider).recordSweep(
          await mockToken.getAddress(),
          hotWallet.address,
          coldWallet.address,
          1000,
          "auto-sweep"
        )
      ).to.be.reverted;
    });

    it("should reject sweep for untracked token", async function () {
      await expect(
        walletRegistry.connect(operator).recordSweep(
          await mockCash.getAddress(),
          hotWallet.address,
          coldWallet.address,
          1000,
          "auto-sweep"
        )
      ).to.be.revertedWith("WalletRegistry: untracked token");
    });

    it("should reject sweep from unregistered wallet", async function () {
      await expect(
        walletRegistry.connect(operator).recordSweep(
          await mockToken.getAddress(),
          outsider.address,
          coldWallet.address,
          1000,
          "auto-sweep"
        )
      ).to.be.revertedWith("WalletRegistry: from not registered");
    });
  });

  // =========================================================================
  // MultiSigWarm — 2-of-3 Multi-Signature
  // =========================================================================
  describe("MultiSigWarm — Multi-Sig Lifecycle", function () {
    beforeEach(async function () {
      // Fund the multi-sig with tokens
      const multiSigAddr = await multiSig.getAddress();
      await mockToken.connect(admin).mint(multiSigAddr, ethers.parseUnits("100000", 18));
    });

    it("should have 3 signers", async function () {
      const signerList = await multiSig.getSigners();
      expect(signerList[0]).to.equal(signer1.address);
      expect(signerList[1]).to.equal(signer2.address);
      expect(signerList[2]).to.equal(signer3.address);
    });

    it("should require 2 confirmations", async function () {
      expect(await multiSig.REQUIRED_CONFIRMATIONS()).to.equal(2);
    });

    it("signer can propose a transaction", async function () {
      const tokenAddr = await mockToken.getAddress();
      await expect(
        multiSig.connect(signer1).proposeTx(tokenAddr, hotWallet.address, 1000, "replenish-hot")
      ).to.emit(multiSig, "TxProposed");

      expect(await multiSig.transactionCount()).to.equal(1);

      const tx = await multiSig.transactions(0);
      expect(tx.confirmations).to.equal(1); // proposer auto-confirms
      expect(tx.executed).to.be.false;
    });

    it("non-signer cannot propose", async function () {
      await expect(
        multiSig.connect(outsider).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test")
      ).to.be.revertedWith("MultiSigWarm: not a signer");
    });

    it("second signer can confirm", async function () {
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test");
      await expect(
        multiSig.connect(signer2).confirmTx(0)
      ).to.emit(multiSig, "TxConfirmed");

      const tx = await multiSig.transactions(0);
      expect(tx.confirmations).to.equal(2);
    });

    it("same signer cannot confirm twice", async function () {
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test");
      await expect(
        multiSig.connect(signer1).confirmTx(0)
      ).to.be.revertedWith("MultiSigWarm: already confirmed");
    });

    it("execute succeeds with 2 confirmations", async function () {
      const tokenAddr = await mockToken.getAddress();
      const amount = ethers.parseUnits("5000", 18);

      await multiSig.connect(signer1).proposeTx(tokenAddr, hotWallet.address, amount, "replenish-hot");
      await multiSig.connect(signer2).confirmTx(0);

      const balBefore = await mockToken.balanceOf(hotWallet.address);
      await multiSig.connect(signer1).executeTx(0);
      const balAfter = await mockToken.balanceOf(hotWallet.address);

      expect(balAfter - balBefore).to.equal(amount);

      const tx = await multiSig.transactions(0);
      expect(tx.executed).to.be.true;
    });

    it("execute fails with only 1 confirmation", async function () {
      await multiSig.connect(signer1).proposeTx(
        await mockToken.getAddress(), hotWallet.address, 1000, "test"
      );

      await expect(
        multiSig.connect(signer1).executeTx(0)
      ).to.be.revertedWith("MultiSigWarm: insufficient confirmations");
    });

    it("cannot execute twice", async function () {
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test");
      await multiSig.connect(signer2).confirmTx(0);
      await multiSig.connect(signer1).executeTx(0);

      await expect(
        multiSig.connect(signer1).executeTx(0)
      ).to.be.revertedWith("MultiSigWarm: already executed");
    });

    it("signer can cancel a transaction", async function () {
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test");
      await expect(
        multiSig.connect(signer2).cancelTx(0)
      ).to.emit(multiSig, "TxCancelled");

      const tx = await multiSig.transactions(0);
      expect(tx.cancelled).to.be.true;
    });

    it("cannot confirm cancelled transaction", async function () {
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test");
      await multiSig.connect(signer2).cancelTx(0);

      await expect(
        multiSig.connect(signer3).confirmTx(0)
      ).to.be.revertedWith("MultiSigWarm: already cancelled");
    });

    it("signer can revoke confirmation", async function () {
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test");
      await multiSig.connect(signer2).confirmTx(0);

      await multiSig.connect(signer2).revokeConfirmation(0);
      const tx = await multiSig.transactions(0);
      expect(tx.confirmations).to.equal(1);
    });

    it("transaction expires after 48 hours", async function () {
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test");
      await multiSig.connect(signer2).confirmTx(0);

      // Advance time by 49 hours
      await ethers.provider.send("evm_increaseTime", [49 * 3600]);
      await mineBlocks(1);

      expect(await multiSig.isExpired(0)).to.be.true;

      await expect(
        multiSig.connect(signer1).executeTx(0)
      ).to.be.revertedWith("MultiSigWarm: transaction expired");
    });

    it("should report pending count correctly", async function () {
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 1000, "test1");
      await multiSig.connect(signer1).proposeTx(await mockToken.getAddress(), hotWallet.address, 2000, "test2");

      expect(await multiSig.pendingCount()).to.equal(2);

      // Execute one
      await multiSig.connect(signer2).confirmTx(0);
      await multiSig.connect(signer1).executeTx(0);

      expect(await multiSig.pendingCount()).to.equal(1);
    });
  });

  // =========================================================================
  // MultiSigWarm — Signer Management
  // =========================================================================
  describe("MultiSigWarm — Signer Management", function () {
    it("should replace a signer", async function () {
      await multiSig.connect(signer1).replaceSigner(2, outsider.address);
      expect(await multiSig.isSigner(outsider.address)).to.be.true;
      expect(await multiSig.isSigner(signer3.address)).to.be.false;
      expect(await multiSig.signers(2)).to.equal(outsider.address);
    });

    it("should reject replacing with zero address", async function () {
      await expect(
        multiSig.connect(signer1).replaceSigner(0, ethers.ZeroAddress)
      ).to.be.revertedWith("MultiSigWarm: zero address");
    });

    it("should reject replacing with existing signer", async function () {
      await expect(
        multiSig.connect(signer1).replaceSigner(0, signer2.address)
      ).to.be.revertedWith("MultiSigWarm: already a signer");
    });
  });

  // =========================================================================
  // Integration — End-to-End Rebalancing Flow
  // =========================================================================
  describe("Integration — Rebalancing Flow", function () {
    it("full rebalance: detect over-cap → propose multi-sig → confirm → execute → record sweep", async function () {
      // Setup: Register wallets and track token
      await walletRegistry.connect(admin).registerWallet(hotWallet.address, HOT, "Hot-FPS");
      await walletRegistry.connect(admin).registerWallet(await multiSig.getAddress(), WARM, "Warm-MultiSig");
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-HSM");
      await walletRegistry.connect(admin).addTrackedToken(await mockToken.getAddress());

      const tokenAddr = await mockToken.getAddress();

      // Simulate: hot wallet has 5% of AUM (over the 2% cap)
      await mockToken.connect(admin).mint(hotWallet.address, ethers.parseUnits("50000", 18));
      await mockToken.connect(admin).mint(coldWallet.address, ethers.parseUnits("950000", 18));

      // 1. Detect over-cap
      expect(await walletRegistry.isHotOverCap(tokenAddr)).to.be.true;

      // 2. Calculate excess: hot=50000, cap=2% of 1M=20000, excess=30000
      const excess = ethers.parseUnits("30000", 18);

      // 3. Hot wallet sends excess to warm (multi-sig) for buffering
      await mockToken.connect(hotWallet).transfer(await multiSig.getAddress(), excess);

      // 4. Multi-sig proposes sweep from warm to cold
      await multiSig.connect(signer1).proposeTx(tokenAddr, coldWallet.address, excess, "sweep-to-cold");

      // 5. Second signer confirms
      await multiSig.connect(signer2).confirmTx(0);

      // 6. Execute the multi-sig transfer
      const coldBefore = await mockToken.balanceOf(coldWallet.address);
      await multiSig.connect(signer3).executeTx(0);
      const coldAfter = await mockToken.balanceOf(coldWallet.address);
      expect(coldAfter - coldBefore).to.equal(excess);

      // 7. Record the sweep on-chain for audit trail
      await walletRegistry.connect(operator).recordSweep(
        tokenAddr,
        await multiSig.getAddress(),
        coldWallet.address,
        excess,
        "auto-sweep"
      );

      // 8. Verify: hot wallet is now within cap
      expect(await walletRegistry.isHotOverCap(tokenAddr)).to.be.false;

      // 9. Verify sweep history
      expect(await walletRegistry.sweepCount()).to.equal(1);
    });

    it("cold wallet transfer should be flagged as restricted", async function () {
      await walletRegistry.connect(admin).registerWallet(coldWallet.address, COLD, "Cold-HSM");

      const [allowed, reason] = await walletRegistry.canTransferFrom(coldWallet.address);
      expect(allowed).to.be.false;
      expect(reason).to.contain("cold wallet transfers blocked");
    });
  });
});
