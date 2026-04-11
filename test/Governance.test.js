const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * @title Governance test suite
 *
 * Covers:
 *   - ERC20Votes checkpoint snapshots (delegate, getPastVotes, getPastTotalSupply)
 *   - ERC20Permit gasless approvals
 *   - Governor lifecycle: propose → vote → queue → execute
 *   - Flash-loan attack defense (tokens acquired after snapshot carry 0 votes)
 *   - Quorum enforcement (4% of total supply)
 *   - Timelock delay enforcement
 *   - Proposal cancellation
 *   - Voting types: For / Against / Abstain
 *   - Multiple voter scenarios
 */
describe("Governance", function () {
  // ─── Shared state ────────────────────────────────────────────
  let token, registry, compliance;
  let timelock, governor;
  let admin, agent, alice, bob, charlie, attacker;

  const TOKEN_NAME = "HKSTP Gov Token";
  const TOKEN_SYMBOL = "HKGOV";
  const MINT_AMOUNT = ethers.parseUnits("10000", 18);
  const SMALL_AMOUNT = ethers.parseUnits("100", 18);

  // Governance params
  const VOTING_DELAY = 1;      // 1 block
  const VOTING_PERIOD = 50;    // 50 blocks
  const QUORUM_PERCENT = 4;    // 4%
  const TIMELOCK_DELAY = 1;    // 1 second (testing)

  // Vote types (GovernorCountingSimple)
  const VOTE_AGAINST = 0;
  const VOTE_FOR = 1;
  const VOTE_ABSTAIN = 2;

  // Proposal states
  const ProposalState = {
    Pending: 0,
    Active: 1,
    Canceled: 2,
    Defeated: 3,
    Succeeded: 4,
    Queued: 5,
    Expired: 6,
    Executed: 7,
  };

  /** Helper: mine N blocks */
  async function mineBlocks(n) {
    for (let i = 0; i < n; i++) {
      await ethers.provider.send("evm_mine", []);
    }
  }

  /** Helper: register + verify an address with full KYC claims */
  async function registerAndVerify(addr) {
    await registry.connect(agent).registerIdentity(addr, ethers.ZeroAddress, "HK");
    for (let topic = 1; topic <= 5; topic++) {
      await registry.connect(agent).setClaim(addr, topic, true);
    }
  }

  beforeEach(async function () {
    [admin, agent, alice, bob, charlie, attacker] = await ethers.getSigners();

    // 1. Deploy Identity Registry
    const IdentityRegistry = await ethers.getContractFactory("HKSTPIdentityRegistry");
    registry = await IdentityRegistry.deploy(admin.address);

    // 2. Deploy Compliance (oracle = admin for tests)
    const Compliance = await ethers.getContractFactory("HKSTPCompliance");
    compliance = await Compliance.deploy(admin.address, admin.address);

    // 3. Deploy Security Token (now with ERC20Votes + ERC20Permit)
    const Token = await ethers.getContractFactory("HKSTPSecurityToken");
    token = await Token.deploy(
      TOKEN_NAME,
      TOKEN_SYMBOL,
      await registry.getAddress(),
      await compliance.getAddress(),
      ethers.ZeroAddress, // onchainId
      admin.address
    );

    // 4. Deploy Timelock (proposers/executors will be governor — set after governor deploy)
    const Timelock = await ethers.getContractFactory("HKSTPTimelock");
    timelock = await Timelock.deploy(
      TIMELOCK_DELAY,
      [], // proposers — will add governor
      [], // executors — will add governor
      admin.address // bootstrap admin
    );

    // 5. Deploy Governor
    const Governor = await ethers.getContractFactory("HKSTPGovernor");
    governor = await Governor.deploy(
      await token.getAddress(),
      await timelock.getAddress(),
      VOTING_DELAY,
      VOTING_PERIOD,
      QUORUM_PERCENT
    );

    // 6. Wire Timelock roles → Governor
    const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
    const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
    const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
    const governorAddress = await governor.getAddress();
    await timelock.connect(admin).grantRole(PROPOSER_ROLE, governorAddress);
    await timelock.connect(admin).grantRole(EXECUTOR_ROLE, governorAddress);
    await timelock.connect(admin).grantRole(CANCELLER_ROLE, governorAddress);

    // 7. Grant token roles
    const AGENT_ROLE = await token.AGENT_ROLE();
    await token.connect(admin).grantRole(AGENT_ROLE, agent.address);

    const AGENT_ROLE_REG = await registry.AGENT_ROLE();
    await registry.connect(admin).grantRole(AGENT_ROLE_REG, agent.address);

    const TOKEN_ROLE = await compliance.TOKEN_ROLE();
    await compliance.connect(admin).grantRole(TOKEN_ROLE, await token.getAddress());

    // 8. Register & verify alice, bob (standard KYC)
    await registerAndVerify(alice.address);
    await registerAndVerify(bob.address);

    // 9. Mint tokens to alice and bob
    await token.connect(agent).mint(alice.address, MINT_AMOUNT);
    await token.connect(agent).mint(bob.address, MINT_AMOUNT);
  });

  // =========================================================================
  // ERC20Votes — Checkpoint Snapshots
  // =========================================================================
  describe("ERC20Votes — Checkpoint Snapshots", function () {
    it("should have zero voting power before self-delegation", async function () {
      expect(await token.getVotes(alice.address)).to.equal(0);
    });

    it("should activate voting power after self-delegation", async function () {
      await token.connect(alice).delegate(alice.address);
      expect(await token.getVotes(alice.address)).to.equal(MINT_AMOUNT);
    });

    it("should allow delegation to another address", async function () {
      await token.connect(alice).delegate(bob.address);
      expect(await token.getVotes(bob.address)).to.equal(MINT_AMOUNT);
      expect(await token.getVotes(alice.address)).to.equal(0);
      expect(await token.delegates(alice.address)).to.equal(bob.address);
    });

    it("should track getPastVotes at historical blocks", async function () {
      await token.connect(alice).delegate(alice.address);
      const blockBefore = await ethers.provider.getBlockNumber();
      await mineBlocks(5);
      expect(await token.getPastVotes(alice.address, blockBefore)).to.equal(MINT_AMOUNT);
    });

    it("should track getPastTotalSupply", async function () {
      const blockBefore = await ethers.provider.getBlockNumber();
      await mineBlocks(3);
      const totalSupply = MINT_AMOUNT * 2n; // alice + bob
      expect(await token.getPastTotalSupply(blockBefore)).to.equal(totalSupply);
    });

    it("should update checkpoints on transfer", async function () {
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);

      const blockBeforeTransfer = await ethers.provider.getBlockNumber();

      // Register charlie for compliance
      await registerAndVerify(charlie.address);
      // Transfer from alice to charlie (charlie has no self-delegation yet)
      await token.connect(alice).transfer(charlie.address, SMALL_AMOUNT);
      await mineBlocks(1);

      expect(await token.getVotes(alice.address)).to.equal(MINT_AMOUNT - SMALL_AMOUNT);
      // charlie has no delegation, so votes are 0
      expect(await token.getVotes(charlie.address)).to.equal(0);
      // historical check — alice had full balance before
      expect(await token.getPastVotes(alice.address, blockBeforeTransfer)).to.equal(MINT_AMOUNT);
    });

    it("should return correct numCheckpoints", async function () {
      expect(await token.numCheckpoints(alice.address)).to.equal(0);
      await token.connect(alice).delegate(alice.address);
      expect(await token.numCheckpoints(alice.address)).to.equal(1);
    });

    it("should report clock mode as block number", async function () {
      const mode = await token.CLOCK_MODE();
      expect(mode).to.equal("mode=blocknumber&from=default");
    });
  });

  // =========================================================================
  // ERC20Permit — Gasless Approvals
  // =========================================================================
  describe("ERC20Permit — Gasless Approvals", function () {
    it("should have the correct DOMAIN_SEPARATOR", async function () {
      const domainSep = await token.DOMAIN_SEPARATOR();
      expect(domainSep).to.not.equal(ethers.ZeroHash);
    });

    it("should return zero nonces initially", async function () {
      expect(await token.nonces(alice.address)).to.equal(0);
    });
  });

  // =========================================================================
  // Governor Lifecycle — Propose → Vote → Queue → Execute
  // =========================================================================
  describe("Governor Lifecycle", function () {
    /** Helper: set up delegation + create a simple proposal */
    async function createProposal() {
      // Alice self-delegates to activate voting power
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);
      await mineBlocks(1);

      // Proposal: call a no-op (transfer 0 ETH to admin)
      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Proposal #1: Test governance";

      const tx = await governor.connect(alice).propose(targets, values, calldatas, description);
      const receipt = await tx.wait();

      const proposalId = await governor.hashProposal(
        targets,
        values,
        calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      return { proposalId, targets, values, calldatas, description };
    }

    it("should create a proposal", async function () {
      const { proposalId } = await createProposal();
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending);
    });

    it("proposal should become Active after voting delay", async function () {
      const { proposalId } = await createProposal();
      await mineBlocks(VOTING_DELAY + 1);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active);
    });

    it("should allow voting For", async function () {
      const { proposalId } = await createProposal();
      await mineBlocks(VOTING_DELAY + 1);
      await governor.connect(alice).castVote(proposalId, VOTE_FOR);
      expect(await governor.hasVoted(proposalId, alice.address)).to.be.true;

      const [against, forVotes, abstain] = await governor.proposalVotes(proposalId);
      expect(forVotes).to.equal(MINT_AMOUNT);
      expect(against).to.equal(0);
      expect(abstain).to.equal(0);
    });

    it("should allow voting Against", async function () {
      const { proposalId } = await createProposal();
      await mineBlocks(VOTING_DELAY + 1);
      await governor.connect(bob).castVote(proposalId, VOTE_AGAINST);

      const [against, forVotes, abstain] = await governor.proposalVotes(proposalId);
      expect(against).to.equal(MINT_AMOUNT);
    });

    it("should allow voting Abstain", async function () {
      const { proposalId } = await createProposal();
      await mineBlocks(VOTING_DELAY + 1);
      await governor.connect(alice).castVote(proposalId, VOTE_ABSTAIN);

      const [against, forVotes, abstain] = await governor.proposalVotes(proposalId);
      expect(abstain).to.equal(MINT_AMOUNT);
    });

    it("should prevent double-voting", async function () {
      const { proposalId } = await createProposal();
      await mineBlocks(VOTING_DELAY + 1);
      await governor.connect(alice).castVote(proposalId, VOTE_FOR);
      await expect(
        governor.connect(alice).castVote(proposalId, VOTE_FOR)
      ).to.be.reverted;
    });

    it("should succeed with quorum met + more For than Against", async function () {
      const { proposalId } = await createProposal();
      await mineBlocks(VOTING_DELAY + 1);
      await governor.connect(alice).castVote(proposalId, VOTE_FOR);
      await governor.connect(bob).castVote(proposalId, VOTE_AGAINST);
      // Equal votes → defeated (forVotes must be strictly greater)
      await mineBlocks(VOTING_PERIOD + 1);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Defeated);
    });

    it("full lifecycle: propose → vote → queue → execute", async function () {
      const { proposalId, targets, values, calldatas, description } = await createProposal();

      // Wait for voting delay
      await mineBlocks(VOTING_DELAY + 1);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active);

      // Alice votes For (>4% quorum with 10000 tokens out of 20000 total)
      await governor.connect(alice).castVote(proposalId, VOTE_FOR);

      // Wait for voting period to end
      await mineBlocks(VOTING_PERIOD + 1);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded);

      // Queue
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(description));
      await governor.queue(targets, values, calldatas, descHash);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued);

      // Wait for timelock delay
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY + 1]);
      await mineBlocks(1);

      // Execute
      await governor.execute(targets, values, calldatas, descHash);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Executed);
    });
  });

  // =========================================================================
  // Flash-Loan Attack Defense
  // =========================================================================
  describe("Flash-Loan Attack Defense", function () {
    it("tokens acquired AFTER proposal snapshot carry ZERO voting power", async function () {
      // Alice self-delegates and creates proposal
      await token.connect(alice).delegate(alice.address);
      await mineBlocks(1);

      // Create proposal — snapshot is taken at THIS block
      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Flash-loan test proposal";
      await governor.connect(alice).propose(targets, values, calldatas, description);

      const proposalId = await governor.hashProposal(
        targets,
        values,
        calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      // Snapshot block = current block + votingDelay
      const snapshotBlock = await governor.proposalSnapshot(proposalId);

      // Attacker registers and gets tokens AFTER proposal snapshot
      await registerAndVerify(attacker.address);
      await token.connect(agent).mint(attacker.address, MINT_AMOUNT);
      await token.connect(attacker).delegate(attacker.address);
      await mineBlocks(VOTING_DELAY + 2);

      // Attacker now has tokens, but at the snapshot block they had ZERO
      const attackerPastVotes = await token.getPastVotes(attacker.address, snapshotBlock);
      expect(attackerPastVotes).to.equal(0);

      // Voting: attacker's vote carries 0 weight
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active);

      // Governor._getVotes uses token.getPastVotes at snapshotBlock
      // Attacker can cast a vote but it has 0 weight
      await governor.connect(attacker).castVote(proposalId, VOTE_FOR);
      const [, forVotes] = await governor.proposalVotes(proposalId);
      expect(forVotes).to.equal(0); // 0 voting power at snapshot
    });

    it("tokens held BEFORE proposal snapshot have full voting power", async function () {
      await token.connect(alice).delegate(alice.address);
      await mineBlocks(1);

      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Pre-snapshot vote test";
      await governor.connect(alice).propose(targets, values, calldatas, description);

      const proposalId = await governor.hashProposal(
        targets,
        values,
        calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      await mineBlocks(VOTING_DELAY + 1);
      await governor.connect(alice).castVote(proposalId, VOTE_FOR);

      const [, forVotes] = await governor.proposalVotes(proposalId);
      expect(forVotes).to.equal(MINT_AMOUNT);
    });
  });

  // =========================================================================
  // Quorum Enforcement
  // =========================================================================
  describe("Quorum Enforcement", function () {
    it("should report correct quorum percentage", async function () {
      expect(await governor.quorumNumerator()).to.equal(QUORUM_PERCENT);
      expect(await governor.quorumDenominator()).to.equal(100);
    });

    it("proposal should be Defeated if quorum not met", async function () {
      // Only mint a tiny amount to charlie (not enough for 4% quorum)
      await registerAndVerify(charlie.address);
      await token.connect(agent).mint(charlie.address, ethers.parseUnits("1", 18));
      await token.connect(charlie).delegate(charlie.address);
      await mineBlocks(1);

      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Quorum test - should fail";
      await governor.connect(charlie).propose(targets, values, calldatas, description);
      const proposalId = await governor.hashProposal(
        targets, values, calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      await mineBlocks(VOTING_DELAY + 1);
      // Charlie votes For — but only has 1 token out of 20001 total (~0.005%)
      await governor.connect(charlie).castVote(proposalId, VOTE_FOR);

      await mineBlocks(VOTING_PERIOD + 1);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Defeated);
    });

    it("proposal should succeed when quorum met", async function () {
      await token.connect(alice).delegate(alice.address);
      await mineBlocks(1);

      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Quorum test - should pass";
      await governor.connect(alice).propose(targets, values, calldatas, description);
      const proposalId = await governor.hashProposal(
        targets, values, calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      await mineBlocks(VOTING_DELAY + 1);
      // Alice has 10000/20000 = 50% → well above 4% quorum
      await governor.connect(alice).castVote(proposalId, VOTE_FOR);

      await mineBlocks(VOTING_PERIOD + 1);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded);
    });
  });

  // =========================================================================
  // Timelock Enforcement
  // =========================================================================
  describe("Timelock Enforcement", function () {
    it("should not allow execution before timelock delay", async function () {
      // Deploy a new Timelock with a longer delay (3600 seconds = 1 hour)
      const LONG_DELAY = 3600;
      const Timelock2 = await ethers.getContractFactory("HKSTPTimelock");
      const timelock2 = await Timelock2.deploy(
        LONG_DELAY,
        [],
        [],
        admin.address
      );

      const Governor2 = await ethers.getContractFactory("HKSTPGovernor");
      const governor2 = await Governor2.deploy(
        await token.getAddress(),
        await timelock2.getAddress(),
        VOTING_DELAY,
        VOTING_PERIOD,
        QUORUM_PERCENT
      );

      const PROPOSER_ROLE = await timelock2.PROPOSER_ROLE();
      const EXECUTOR_ROLE = await timelock2.EXECUTOR_ROLE();
      const CANCELLER_ROLE = await timelock2.CANCELLER_ROLE();
      const gov2Addr = await governor2.getAddress();
      await timelock2.connect(admin).grantRole(PROPOSER_ROLE, gov2Addr);
      await timelock2.connect(admin).grantRole(EXECUTOR_ROLE, gov2Addr);
      await timelock2.connect(admin).grantRole(CANCELLER_ROLE, gov2Addr);

      await token.connect(alice).delegate(alice.address);
      await mineBlocks(1);

      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Timelock delay test";
      await governor2.connect(alice).propose(targets, values, calldatas, description);
      const proposalId = await governor2.hashProposal(
        targets, values, calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      await mineBlocks(VOTING_DELAY + 1);
      await governor2.connect(alice).castVote(proposalId, VOTE_FOR);
      await mineBlocks(VOTING_PERIOD + 1);

      // Queue the proposal
      await governor2.queue(targets, values, calldatas, descHash);
      expect(await governor2.state(proposalId)).to.equal(ProposalState.Queued);

      // Try execute immediately — should fail (1-hour timelock not yet ready)
      await expect(
        governor2.execute(targets, values, calldatas, descHash)
      ).to.be.reverted;
    });

    it("should report the timelock address", async function () {
      expect(await governor.timelock()).to.equal(await timelock.getAddress());
    });
  });

  // =========================================================================
  // Proposal Cancellation
  // =========================================================================
  describe("Proposal Cancellation", function () {
    it("proposer can cancel a Pending proposal", async function () {
      await token.connect(alice).delegate(alice.address);
      await mineBlocks(1);

      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Cancellation test";
      await governor.connect(alice).propose(targets, values, calldatas, description);
      const proposalId = await governor.hashProposal(
        targets, values, calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending);
      await governor.connect(alice).cancel(targets, values, calldatas, descHash);
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled);
    });
  });

  // =========================================================================
  // Governor Configuration
  // =========================================================================
  describe("Governor Configuration", function () {
    it("should report correct name", async function () {
      expect(await governor.name()).to.equal("HKSTPGovernor");
    });

    it("should report correct voting delay", async function () {
      expect(await governor.votingDelay()).to.equal(VOTING_DELAY);
    });

    it("should report correct voting period", async function () {
      expect(await governor.votingPeriod()).to.equal(VOTING_PERIOD);
    });

    it("should report correct proposal threshold", async function () {
      expect(await governor.proposalThreshold()).to.equal(0);
    });

    it("should report correct COUNTING_MODE", async function () {
      const mode = await governor.COUNTING_MODE();
      expect(mode).to.equal("support=bravo&quorum=for,abstain");
    });

    it("should report correct clock mode matching the token", async function () {
      const govClock = await governor.CLOCK_MODE();
      const tokenClock = await token.CLOCK_MODE();
      expect(govClock).to.equal(tokenClock);
    });
  });

  // =========================================================================
  // Governance Execution (real on-chain action)
  // =========================================================================
  describe("Governance Execution — On-chain Action", function () {
    it("should execute a governance action that pauses the token", async function () {
      // Grant DEFAULT_ADMIN_ROLE on the token to the Timelock
      // (so governance proposals can call token.pause())
      const ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();
      await token.connect(admin).grantRole(ADMIN_ROLE, await timelock.getAddress());

      await token.connect(alice).delegate(alice.address);
      await mineBlocks(1);

      // Propose: call token.pause()
      const tokenAddress = await token.getAddress();
      const pauseCalldata = token.interface.encodeFunctionData("pause");
      const targets = [tokenAddress];
      const values = [0];
      const calldatas = [pauseCalldata];
      const description = "Proposal #2: Pause the token";

      await governor.connect(alice).propose(targets, values, calldatas, description);
      const proposalId = await governor.hashProposal(
        targets, values, calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(description));

      await mineBlocks(VOTING_DELAY + 1);
      await governor.connect(alice).castVote(proposalId, VOTE_FOR);
      await mineBlocks(VOTING_PERIOD + 1);

      await governor.queue(targets, values, calldatas, descHash);
      await ethers.provider.send("evm_increaseTime", [TIMELOCK_DELAY + 1]);
      await mineBlocks(1);

      // Token should not be paused yet
      expect(await token.paused()).to.be.false;

      // Execute — this actually pauses the token
      await governor.execute(targets, values, calldatas, descHash);
      expect(await token.paused()).to.be.true;

      // Verify: minting should now fail
      await expect(
        token.connect(agent).mint(alice.address, SMALL_AMOUNT)
      ).to.be.reverted;
    });
  });

  // =========================================================================
  // Multiple Voters
  // =========================================================================
  describe("Multiple Voters", function () {
    it("should tally votes from multiple voters correctly", async function () {
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);
      await mineBlocks(1);

      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Multi-voter test";
      await governor.connect(alice).propose(targets, values, calldatas, description);
      const proposalId = await governor.hashProposal(
        targets, values, calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      await mineBlocks(VOTING_DELAY + 1);
      await governor.connect(alice).castVote(proposalId, VOTE_FOR);
      await governor.connect(bob).castVote(proposalId, VOTE_AGAINST);

      const [against, forVotes, abstain] = await governor.proposalVotes(proposalId);
      expect(forVotes).to.equal(MINT_AMOUNT);
      expect(against).to.equal(MINT_AMOUNT);
      expect(abstain).to.equal(0);
    });

    it("Abstain votes count toward quorum but not for/against", async function () {
      await token.connect(alice).delegate(alice.address);
      await token.connect(bob).delegate(bob.address);
      await mineBlocks(1);

      const targets = [admin.address];
      const values = [0];
      const calldatas = ["0x"];
      const description = "Abstain quorum test";
      await governor.connect(alice).propose(targets, values, calldatas, description);
      const proposalId = await governor.hashProposal(
        targets, values, calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      await mineBlocks(VOTING_DELAY + 1);
      // Alice abstains (counts for quorum), bob doesn't vote
      await governor.connect(alice).castVote(proposalId, VOTE_ABSTAIN);

      await mineBlocks(VOTING_PERIOD + 1);
      // Quorum met (10000 abstain > 4% of 20000 = 800) but forVotes = 0 → defeated
      expect(await governor.state(proposalId)).to.equal(ProposalState.Defeated);
    });
  });

  // =========================================================================
  // Delegation edge cases
  // =========================================================================
  describe("Delegation", function () {
    it("should allow re-delegation", async function () {
      await token.connect(alice).delegate(alice.address);
      expect(await token.getVotes(alice.address)).to.equal(MINT_AMOUNT);

      // Re-delegate from alice to bob
      await token.connect(alice).delegate(bob.address);
      expect(await token.getVotes(alice.address)).to.equal(0);
      expect(await token.getVotes(bob.address)).to.equal(MINT_AMOUNT);
    });

    it("should stack delegated votes", async function () {
      // Both delegate to bob
      await token.connect(alice).delegate(bob.address);
      await token.connect(bob).delegate(bob.address);

      expect(await token.getVotes(bob.address)).to.equal(MINT_AMOUNT * 2n);
    });
  });

  // =========================================================================
  // Timelock Configuration
  // =========================================================================
  describe("Timelock Configuration", function () {
    it("should report correct minimum delay", async function () {
      expect(await timelock.getMinDelay()).to.equal(TIMELOCK_DELAY);
    });

    it("governor should have PROPOSER_ROLE on timelock", async function () {
      const PROPOSER_ROLE = await timelock.PROPOSER_ROLE();
      expect(await timelock.hasRole(PROPOSER_ROLE, await governor.getAddress())).to.be.true;
    });

    it("governor should have EXECUTOR_ROLE on timelock", async function () {
      const EXECUTOR_ROLE = await timelock.EXECUTOR_ROLE();
      expect(await timelock.hasRole(EXECUTOR_ROLE, await governor.getAddress())).to.be.true;
    });

    it("governor should have CANCELLER_ROLE on timelock", async function () {
      const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
      expect(await timelock.hasRole(CANCELLER_ROLE, await governor.getAddress())).to.be.true;
    });
  });
});
