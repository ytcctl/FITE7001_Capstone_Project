// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title GovernorFactory
 * @notice Registry that tracks a dedicated HKSTPGovernor + HKSTPTimelock
 *         pair for each security token, enabling per-token on-chain governance.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Each token gets its own Governor + Timelock.                   │
 * │  Governor and Timelock are deployed externally (off-chain script│
 * │  or separate deployer) and registered here via registerGovernance.│
 * │  The factory keeps a registry of (token → governor, timelock).  │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — platform admin; can register governance suites
 */
contract GovernorFactory is AccessControl {

    // ── Per-token governance registry ───────────────────────────────
    struct GovernanceSuite {
        address token;
        address governor;
        address timelock;
        uint256 deployedAt;
    }

    /// @dev token address → GovernanceSuite
    mapping(address => GovernanceSuite) private _suites;

    /// @dev ordered list of all governed tokens
    address[] private _governedTokens;

    // ── Events ──────────────────────────────────────────────────────
    event GovernanceRegistered(
        address indexed token,
        address indexed governor,
        address indexed timelock,
        address registeredBy
    );

    // ── Constructor ─────────────────────────────────────────────────
    constructor(address admin_) {
        require(admin_ != address(0), "GovernorFactory: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // ── Register governance for a token ─────────────────────────────

    /**
     * @notice Register a pre-deployed HKSTPGovernor + HKSTPTimelock pair for a token.
     * @param token_     The ERC20Votes-compatible security token address.
     * @param governor_  The deployed HKSTPGovernor address.
     * @param timelock_  The deployed HKSTPTimelock address.
     */
    function registerGovernance(
        address token_,
        address governor_,
        address timelock_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(token_ != address(0), "GovernorFactory: zero token");
        require(governor_ != address(0), "GovernorFactory: zero governor");
        require(timelock_ != address(0), "GovernorFactory: zero timelock");
        require(
            _suites[token_].governor == address(0),
            "GovernorFactory: governance already registered"
        );

        _suites[token_] = GovernanceSuite({
            token:      token_,
            governor:   governor_,
            timelock:   timelock_,
            deployedAt: block.timestamp
        });
        _governedTokens.push(token_);

        emit GovernanceRegistered(token_, governor_, timelock_, msg.sender);
    }

    // ── View functions ──────────────────────────────────────────────

    function getGovernance(address token_) external view returns (GovernanceSuite memory) {
        require(_suites[token_].governor != address(0), "GovernorFactory: no governance for token");
        return _suites[token_];
    }

    function hasGovernance(address token_) external view returns (bool) {
        return _suites[token_].governor != address(0);
    }

    function governedTokenCount() external view returns (uint256) {
        return _governedTokens.length;
    }

    function governedTokenAt(uint256 index) external view returns (address) {
        require(index < _governedTokens.length, "GovernorFactory: index out of bounds");
        return _governedTokens[index];
    }

    function allGovernedTokens() external view returns (address[] memory) {
        return _governedTokens;
    }

    function allGovernanceSuites() external view returns (GovernanceSuite[] memory) {
        GovernanceSuite[] memory result = new GovernanceSuite[](_governedTokens.length);
        for (uint256 i = 0; i < _governedTokens.length; i++) {
            result[i] = _suites[_governedTokens[i]];
        }
        return result;
    }
}
