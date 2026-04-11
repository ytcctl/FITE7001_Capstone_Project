// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

/// @dev Minimal interface — only `isVerified` is needed for the KYC gate.
interface IIdentityRegistryGov {
    function isVerified(address investor) external view returns (bool);
}

/**
 * @title HKSTPGovernor
 * @notice On-chain governance for HKSTP security-token platform.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Flash-loan resistant: uses ERC20Votes checkpoint snapshots.     │
 * │  Votes are recorded at the *proposal creation block*, so tokens │
 * │  acquired after a proposal is created carry zero voting power.  │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  Identity-Locked Voting                                          │
 * │  Every castVote call checks the voter's KYC status via the      │
 * │  HKSTPIdentityRegistry. If KYC has expired or been revoked,     │
 * │  the vote reverts — even if the voter holds delegated power.    │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  Inheritance chain:                                              │
 * │  Governor                                                        │
 * │  ├─ GovernorSettings         — configurable delay/period/thresh │
 * │  ├─ GovernorCountingSimple   — For / Against / Abstain          │
 * │  ├─ GovernorVotes            — ERC20Votes snapshot vote weight  │
 * │  ├─ GovernorVotesQuorumFraction — %-of-supply quorum            │
 * │  └─ GovernorTimelockControl  — timelock execution queue         │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Production governance parameters (passed at deployment):
 *   - Voting delay:        14400 blocks  (~2 days at 12s/block)
 *   - Voting period:       50400 blocks  (~7 days at 12s/block)
 *   - Proposal threshold:  1% of total supply
 *   - Quorum:              10% of total supply
 *   - Timelock delay:      172800 seconds (48 hours)
 */
contract HKSTPGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    /// @notice The HKSTPIdentityRegistry used for KYC verification at vote-time.
    IIdentityRegistryGov public immutable identityRegistry;

    /// @dev Emitted when a vote is blocked due to expired / revoked KYC.
    event VoteBlockedKYC(uint256 indexed proposalId, address indexed voter);

    /**
     * @param token_             ERC20Votes-compatible security token (IVotes).
     * @param timelock_          TimelockController that enforces execution delay.
     * @param identityRegistry_  HKSTPIdentityRegistry for live KYC checks.
     * @param votingDelay_       Number of blocks after proposal before voting starts.
     * @param votingPeriod_      Number of blocks voting remains open.
     * @param proposalThreshold_ Minimum voting power required to create a proposal.
     * @param quorumPercent_     Quorum as a percentage of total supply (e.g. 10 = 10%).
     */
    constructor(
        IVotes token_,
        TimelockController timelock_,
        address identityRegistry_,
        uint48 votingDelay_,
        uint32 votingPeriod_,
        uint256 proposalThreshold_,
        uint256 quorumPercent_
    )
        Governor("HKSTPGovernor")
        GovernorSettings(votingDelay_, votingPeriod_, proposalThreshold_)
        GovernorVotes(token_)
        GovernorVotesQuorumFraction(quorumPercent_)
        GovernorTimelockControl(timelock_)
    {
        require(identityRegistry_ != address(0), "HKSTPGovernor: zero registry");
        identityRegistry = IIdentityRegistryGov(identityRegistry_);
    }

    // -------------------------------------------------------------------------
    // Identity-locked voting — KYC gate on every vote
    // -------------------------------------------------------------------------

    /**
     * @dev Override the internal _castVote to enforce a live KYC check.
     *      If the voter's identity is no longer verified (KYC expired,
     *      revoked, or never issued), the transaction reverts.
     */
    function _castVote(
        uint256 proposalId,
        address account,
        uint8 support,
        string memory reason,
        bytes memory params
    ) internal virtual override returns (uint256) {
        require(
            identityRegistry.isVerified(account),
            "HKSTPGovernor: voter KYC not verified"
        );
        return super._castVote(proposalId, account, support, reason, params);
    }

    // -------------------------------------------------------------------------
    // Required override resolution (diamond inheritance)
    // -------------------------------------------------------------------------

    function votingDelay()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingDelay();
    }

    function votingPeriod()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber)
        public
        view
        override(Governor, GovernorVotesQuorumFraction)
        returns (uint256)
    {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(Governor, GovernorTimelockControl)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function proposalThreshold()
        public
        view
        override(Governor, GovernorSettings)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint48)
    {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
    {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    )
        internal
        override(Governor, GovernorTimelockControl)
        returns (uint256)
    {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(Governor, GovernorTimelockControl)
        returns (address)
    {
        return super._executor();
    }
}
