// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title HKSTPTimelock
 * @notice Timelock controller for HKSTPGovernor.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Enforces a minimum delay between proposal approval and         │
 * │  execution, giving stakeholders time to react to governance     │
 * │  decisions (e.g. exit positions before parameter changes).      │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Roles:
 *   PROPOSER_ROLE  — granted to the Governor contract
 *   EXECUTOR_ROLE  — granted to the Governor contract (or address(0) for open execution)
 *   CANCELLER_ROLE — granted to the Governor contract
 *   DEFAULT_ADMIN_ROLE — self-administered (address(this)) + optional admin for bootstrapping
 *
 * Default minimum delay: 1 block (testing); production should use 24-48 hours.
 */
contract HKSTPTimelock is TimelockController {
    /**
     * @param minDelay    Minimum delay (in seconds) before a queued operation can be executed.
     * @param proposers   Array of addresses granted PROPOSER_ROLE (typically just the Governor).
     * @param executors   Array of addresses granted EXECUTOR_ROLE.
     *                    Pass [address(0)] to allow anyone to execute ready operations.
     * @param admin       Optional bootstrap admin. Pass address(0) to disable.
     */
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
