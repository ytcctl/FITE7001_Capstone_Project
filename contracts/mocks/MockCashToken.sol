// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal interface for HKSTPIdentityRegistry
interface IIdentityRegistry {
    function isVerified(address investor) external view returns (bool);
}

/**
 * @title MockCashToken
 * @notice ERC-20 representing tokenized HKD (THKD) — the cash leg of DvP settlement.
 *
 * Originally a plain mock with no compliance checks. Now gated on the same
 * `HKSTPIdentityRegistry.isVerified()` predicate as the security token, so
 * THKD cannot be minted, transferred, or received by an unverified wallet.
 *
 * Protocol contracts that hold THKD transiently (DvPSettlement escrow,
 * OrderBook escrow, MultiSigWarm custody) are exempted via `safeListed[]` —
 * they enforce their own compliance at their entry points.
 *
 * Used in test scenarios to simulate the cash leg of a DvP settlement
 * (Project Ensemble / FPS-backed stablecoin equivalent).
 */
contract MockCashToken is ERC20, Ownable {
    /// @notice Number of decimal places. Matches USDC/HKD convention (6 decimals).
    uint8 private _decimals;

    /// @notice Identity registry consulted by `_update`. May be `address(0)` to
    ///         disable KYC enforcement (preserves the original mock behavior).
    IIdentityRegistry public identityRegistry;

    /// @notice Addresses exempt from `isVerified()` checks — typically protocol
    ///         contracts that hold THKD in escrow on behalf of users.
    mapping(address => bool) public safeListed;

    event IdentityRegistryUpdated(address indexed registry);
    event SafeListUpdated(address indexed account, bool status);

    /**
     * @param name_     Token name, e.g. "Tokenized HKD".
     * @param symbol_   Token symbol, e.g. "THKD".
     * @param decimals_ Decimal precision (6 for HKD stablecoin convention).
     * @param owner_    Initial owner (mint/burn authority + admin).
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8  decimals_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        _decimals = decimals_;
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /**
     * @notice Wire (or rewire) the identity registry used for KYC enforcement.
     *         Pass `address(0)` to disable enforcement entirely.
     */
    function setIdentityRegistry(address registry) external onlyOwner {
        identityRegistry = IIdentityRegistry(registry);
        emit IdentityRegistryUpdated(registry);
    }

    /**
     * @notice Mark `account` as exempt from KYC checks. Intended for protocol
     *         contracts (DvP settlement, OrderBook, custody multisig) that
     *         hold THKD transiently and enforce compliance at their own entry
     *         points.
     */
    function setSafeList(address account, bool status) external onlyOwner {
        safeListed[account] = status;
        emit SafeListUpdated(account, status);
    }

    // -------------------------------------------------------------------------
    // Mint / Burn (owner-gated)
    // -------------------------------------------------------------------------

    /**
     * @notice Mint THKD to `to`. Subject to KYC enforcement in `_update`.
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn THKD from `from`. Subject to KYC enforcement in `_update`
     *         (sender must still be verified or safe-listed).
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    // -------------------------------------------------------------------------
    // ERC-20 transfer override — KYC-aware
    // -------------------------------------------------------------------------

    /**
     * @dev Hook called before every mint, burn, and transfer.
     *      - Burn (to == 0): no recipient check.
     *      - Mint (from == 0): recipient must be verified or safe-listed.
     *      - Transfer: both sides must be verified or safe-listed.
     *      KYC enforcement is skipped entirely when `identityRegistry` is unset
     *      (preserves the original mock behavior for legacy deployments).
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal override {
        if (address(identityRegistry) != address(0)) {
            if (to != address(0) && !safeListed[to]) {
                require(
                    identityRegistry.isVerified(to),
                    "MockCashToken: recipient not KYC-verified"
                );
            }
            if (from != address(0) && !safeListed[from]) {
                require(
                    identityRegistry.isVerified(from),
                    "MockCashToken: sender not KYC-verified"
                );
            }
        }
        super._update(from, to, amount);
    }
}
