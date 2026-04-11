// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";

/**
 * @title HKSTPGovernor
 * @notice On-chain governance for HKSTP security-token platform.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Flash-loan resistant: uses ERC20Votes checkpoint snapshots.     │
 * │  Votes are recorded at the *proposal creation block*, so tokens │
 * │  acquired after a proposal is created carry zero voting power.  │
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
 * Default governance parameters:
 *   - Voting delay:     1 block  (immediate for testing; production: increase)
 *   - Voting period:    50 blocks (~50s on Besu; production: ~1 week)
 *   - Proposal threshold: 0 (any token holder can propose)
 *   - Quorum:           4% of total supply
 */
contract HKSTPGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    /**
     * @param token_     ERC20Votes-compatible security token (IVotes).
     * @param timelock_  TimelockController that enforces execution delay.
     * @param votingDelay_     Number of blocks after proposal before voting starts.
     * @param votingPeriod_    Number of blocks voting remains open.
     * @param quorumPercent_   Quorum as a percentage of total supply (e.g. 4 = 4%).
     */
    constructor(
        IVotes token_,
        TimelockController timelock_,
        uint48 votingDelay_,
        uint32 votingPeriod_,
        uint256 quorumPercent_
    )
        Governor("HKSTPGovernor")
        GovernorSettings(votingDelay_, votingPeriod_, 0) // proposalThreshold = 0
        GovernorVotes(token_)
        GovernorVotesQuorumFraction(quorumPercent_)
        GovernorTimelockControl(timelock_)
    {}

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
