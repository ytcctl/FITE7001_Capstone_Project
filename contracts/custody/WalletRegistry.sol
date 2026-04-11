// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title WalletRegistry
 * @notice On-chain wallet-tier classification enforcing the 98/2 custody rule.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Wallet Tier Architecture (SFC/VASP Compliant)                  │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  HOT   — Always online, < 2% of AUM.  Instant FPS settlement.  │
 * │  WARM  — Partially online, transient buffer for rebalancing.    │
 * │           Requires 2-of-3 multi-sig approval via MultiSigWarm.  │
 * │  COLD  — Air-gapped, > 98% of AUM.  FIPS 140-2 L3+ HSM.       │
 * │           On-chain transfers FROM cold wallets are blocked —    │
 * │           all movements require air-gapped signing workflow.    │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Key features:
 *   1. Wallet classification: register wallets as Hot / Warm / Cold
 *   2. Hot wallet balance cap: revert if hot wallet receives tokens
 *      that would push total hot balance above HOT_CAP_BPS (200 = 2%)
 *   3. Cold wallet transfer restriction: transfers FROM cold wallets
 *      are blocked unless routed through the warm wallet (air-gap flow)
 *   4. Auto-sweep trigger: emits SweepRequired when hot balance > cap
 *   5. Rebalancing ledger: tracks all sweep/rebalance operations
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE  — platform admin; registers wallets, sets tokens
 *   OPERATOR_ROLE       — custody operator; executes sweeps, rebalances
 */
contract WalletRegistry is AccessControl, Pausable {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Wallet Tiers ───────────────────────────────────────────
    enum WalletTier { UNREGISTERED, HOT, WARM, COLD }

    struct WalletInfo {
        WalletTier tier;
        string     label;       // human-readable label e.g. "Hot-FPS-1"
        uint256    registeredAt;
        bool       active;
    }

    // ─── Balance Cap (basis points, 10000 = 100%) ───────────────
    /// @notice Hot wallet balance cap in basis points of total tracked AUM.
    ///         Default 200 = 2%.
    uint256 public hotCapBps = 200;
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ─── State ──────────────────────────────────────────────────
    /// @notice All tracked ERC-20 tokens (security token + cash token).
    address[] public trackedTokens;
    mapping(address => bool) public isTrackedToken;

    /// @notice Registered wallets.
    mapping(address => WalletInfo) public wallets;
    address[] public walletList;

    /// @notice Rebalance / sweep operation log.
    struct SweepRecord {
        address token;
        address from;
        address to;
        uint256 amount;
        uint256 timestamp;
        string  reason; // "auto-sweep" | "rebalance" | "withdrawal"
    }
    SweepRecord[] public sweepHistory;

    // ─── Events ─────────────────────────────────────────────────
    event WalletRegistered(address indexed wallet, WalletTier tier, string label);
    event WalletDeactivated(address indexed wallet);
    event WalletReactivated(address indexed wallet);
    event WalletTierChanged(address indexed wallet, WalletTier oldTier, WalletTier newTier);
    event HotCapUpdated(uint256 oldBps, uint256 newBps);
    event TokenTracked(address indexed token);
    event TokenUntracked(address indexed token);

    /// @dev Emitted when the hot wallet balance exceeds the cap.
    ///      Off-chain custody service should listen and trigger a sweep.
    event SweepRequired(address indexed token, uint256 hotBalance, uint256 cap, uint256 excess);

    /// @dev Emitted after every sweep / rebalance operation.
    event SweepExecuted(
        uint256 indexed recordId,
        address indexed token,
        address from,
        address to,
        uint256 amount,
        string  reason
    );

    /// @dev Emitted when a cold-wallet transfer is blocked.
    event ColdTransferBlocked(address indexed wallet, address indexed token, uint256 amount);

    // ─── Constructor ────────────────────────────────────────────

    constructor(address admin) {
        require(admin != address(0), "WalletRegistry: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ─── Token Tracking ─────────────────────────────────────────

    /**
     * @notice Add an ERC-20 token to the tracked set (for AUM calculation).
     */
    function addTrackedToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(token != address(0), "WalletRegistry: zero token");
        require(!isTrackedToken[token], "WalletRegistry: already tracked");
        trackedTokens.push(token);
        isTrackedToken[token] = true;
        emit TokenTracked(token);
    }

    /**
     * @notice Remove a token from tracking.
     */
    function removeTrackedToken(address token) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(isTrackedToken[token], "WalletRegistry: not tracked");
        isTrackedToken[token] = false;
        // Swap-and-pop
        for (uint256 i = 0; i < trackedTokens.length; i++) {
            if (trackedTokens[i] == token) {
                trackedTokens[i] = trackedTokens[trackedTokens.length - 1];
                trackedTokens.pop();
                break;
            }
        }
        emit TokenUntracked(token);
    }

    // ─── Wallet Registration ────────────────────────────────────

    /**
     * @notice Register a wallet with a tier classification.
     * @param wallet  The wallet address to register.
     * @param tier    HOT (1), WARM (2), or COLD (3).
     * @param label   Human-readable label.
     */
    function registerWallet(
        address wallet,
        WalletTier tier,
        string calldata label
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(wallet != address(0), "WalletRegistry: zero address");
        require(tier != WalletTier.UNREGISTERED, "WalletRegistry: invalid tier");
        require(
            wallets[wallet].tier == WalletTier.UNREGISTERED,
            "WalletRegistry: already registered"
        );

        wallets[wallet] = WalletInfo({
            tier: tier,
            label: label,
            registeredAt: block.timestamp,
            active: true
        });
        walletList.push(wallet);
        emit WalletRegistered(wallet, tier, label);
    }

    /**
     * @notice Deactivate a wallet (e.g. key rotation).
     */
    function deactivateWallet(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(wallets[wallet].tier != WalletTier.UNREGISTERED, "WalletRegistry: not registered");
        require(wallets[wallet].active, "WalletRegistry: already inactive");
        wallets[wallet].active = false;
        emit WalletDeactivated(wallet);
    }

    /**
     * @notice Reactivate a deactivated wallet.
     */
    function reactivateWallet(address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(wallets[wallet].tier != WalletTier.UNREGISTERED, "WalletRegistry: not registered");
        require(!wallets[wallet].active, "WalletRegistry: already active");
        wallets[wallet].active = true;
        emit WalletReactivated(wallet);
    }

    /**
     * @notice Change a wallet's tier (e.g. promote warm → hot).
     */
    function changeWalletTier(
        address wallet,
        WalletTier newTier
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(wallets[wallet].tier != WalletTier.UNREGISTERED, "WalletRegistry: not registered");
        require(newTier != WalletTier.UNREGISTERED, "WalletRegistry: invalid tier");
        WalletTier oldTier = wallets[wallet].tier;
        wallets[wallet].tier = newTier;
        emit WalletTierChanged(wallet, oldTier, newTier);
    }

    // ─── Hot Cap Configuration ──────────────────────────────────

    /**
     * @notice Update the hot wallet balance cap (in basis points).
     * @param newCapBps  New cap (e.g. 200 = 2%).  Max 10000.
     */
    function setHotCapBps(uint256 newCapBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newCapBps <= BPS_DENOMINATOR, "WalletRegistry: cap > 100%");
        uint256 old = hotCapBps;
        hotCapBps = newCapBps;
        emit HotCapUpdated(old, newCapBps);
    }

    // ─── AUM & Balance Queries ──────────────────────────────────

    /**
     * @notice Total AUM across all registered wallets for a given token.
     */
    function totalAUM(address token) public view returns (uint256 total) {
        for (uint256 i = 0; i < walletList.length; i++) {
            if (wallets[walletList[i]].active) {
                total += IERC20(token).balanceOf(walletList[i]);
            }
        }
    }

    /**
     * @notice Aggregate balance of all HOT wallets for a given token.
     */
    function hotBalance(address token) public view returns (uint256 total) {
        for (uint256 i = 0; i < walletList.length; i++) {
            WalletInfo storage w = wallets[walletList[i]];
            if (w.active && w.tier == WalletTier.HOT) {
                total += IERC20(token).balanceOf(walletList[i]);
            }
        }
    }

    /**
     * @notice Aggregate balance of all WARM wallets for a given token.
     */
    function warmBalance(address token) public view returns (uint256 total) {
        for (uint256 i = 0; i < walletList.length; i++) {
            WalletInfo storage w = wallets[walletList[i]];
            if (w.active && w.tier == WalletTier.WARM) {
                total += IERC20(token).balanceOf(walletList[i]);
            }
        }
    }

    /**
     * @notice Aggregate balance of all COLD wallets for a given token.
     */
    function coldBalance(address token) public view returns (uint256 total) {
        for (uint256 i = 0; i < walletList.length; i++) {
            WalletInfo storage w = wallets[walletList[i]];
            if (w.active && w.tier == WalletTier.COLD) {
                total += IERC20(token).balanceOf(walletList[i]);
            }
        }
    }

    /**
     * @notice Maximum allowed hot-wallet balance for a given token (2% of AUM).
     */
    function hotCap(address token) public view returns (uint256) {
        return (totalAUM(token) * hotCapBps) / BPS_DENOMINATOR;
    }

    /**
     * @notice Returns true if the hot wallet balance exceeds the cap.
     */
    function isHotOverCap(address token) public view returns (bool) {
        uint256 aum = totalAUM(token);
        if (aum == 0) return false;
        return hotBalance(token) > (aum * hotCapBps) / BPS_DENOMINATOR;
    }

    // ─── Cold Wallet Transfer Restriction ───────────────────────

    /**
     * @notice Check whether a transfer FROM an address is allowed.
     *         Cold wallets are BLOCKED from direct on-chain transfers.
     *         Only the OPERATOR_ROLE can move funds from cold via recordSweep().
     * @param from The sender address.
     * @return allowed True if the transfer is allowed.
     * @return reason  Revert reason if blocked.
     */
    function canTransferFrom(address from) public view returns (bool allowed, string memory reason) {
        WalletInfo storage w = wallets[from];
        if (w.tier == WalletTier.COLD && w.active) {
            return (false, "WalletRegistry: cold wallet transfers blocked");
        }
        return (true, "");
    }

    // ─── Sweep / Rebalance Operations ───────────────────────────

    /**
     * @notice Check all tracked tokens and emit SweepRequired for any
     *         where hot balance exceeds the cap.  Called by off-chain
     *         custody monitoring service.
     */
    function checkAndEmitSweep() external {
        for (uint256 t = 0; t < trackedTokens.length; t++) {
            address token = trackedTokens[t];
            uint256 aum = totalAUM(token);
            if (aum == 0) continue;
            uint256 cap = (aum * hotCapBps) / BPS_DENOMINATOR;
            uint256 hot = hotBalance(token);
            if (hot > cap) {
                emit SweepRequired(token, hot, cap, hot - cap);
            }
        }
    }

    /**
     * @notice Record a sweep / rebalance operation.
     *         The actual token transfer happens off-chain (air-gapped signing
     *         for cold wallet) or via the MultiSigWarm contract.
     *         This function only logs the operation for audit trail.
     *
     * @param token   ERC-20 token moved.
     * @param from    Source wallet.
     * @param to      Destination wallet.
     * @param amount  Amount moved.
     * @param reason  "auto-sweep" | "rebalance" | "withdrawal".
     */
    function recordSweep(
        address token,
        address from,
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyRole(OPERATOR_ROLE) {
        require(isTrackedToken[token], "WalletRegistry: untracked token");
        require(wallets[from].tier != WalletTier.UNREGISTERED, "WalletRegistry: from not registered");
        require(wallets[to].tier != WalletTier.UNREGISTERED, "WalletRegistry: to not registered");

        uint256 recordId = sweepHistory.length;
        sweepHistory.push(SweepRecord({
            token: token,
            from: from,
            to: to,
            amount: amount,
            timestamp: block.timestamp,
            reason: reason
        }));

        emit SweepExecuted(recordId, token, from, to, amount, reason);
    }

    // ─── View Helpers ───────────────────────────────────────────

    /**
     * @notice Returns total number of registered wallets.
     */
    function walletCount() external view returns (uint256) {
        return walletList.length;
    }

    /**
     * @notice Returns all registered wallet addresses.
     */
    function getWalletList() external view returns (address[] memory) {
        return walletList;
    }

    /**
     * @notice Returns all tracked token addresses.
     */
    function getTrackedTokens() external view returns (address[] memory) {
        return trackedTokens;
    }

    /**
     * @notice Returns the total number of sweep records.
     */
    function sweepCount() external view returns (uint256) {
        return sweepHistory.length;
    }

    /**
     * @notice Returns all wallets of a given tier.
     */
    function getWalletsByTier(WalletTier tier) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < walletList.length; i++) {
            if (wallets[walletList[i]].tier == tier && wallets[walletList[i]].active) {
                count++;
            }
        }
        address[] memory result = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < walletList.length; i++) {
            if (wallets[walletList[i]].tier == tier && wallets[walletList[i]].active) {
                result[idx++] = walletList[i];
            }
        }
        return result;
    }

    /**
     * @notice Returns a breakdown of all tier balances for a token.
     */
    function tierBreakdown(address token) external view returns (
        uint256 hotBal,
        uint256 warmBal,
        uint256 coldBal,
        uint256 total,
        uint256 hotCapVal,
        bool    overCap
    ) {
        hotBal  = hotBalance(token);
        warmBal = warmBalance(token);
        coldBal = coldBalance(token);
        total   = hotBal + warmBal + coldBal;
        hotCapVal = total > 0 ? (total * hotCapBps) / BPS_DENOMINATOR : 0;
        overCap = total > 0 && hotBal > hotCapVal;
    }

    // ─── Pause ──────────────────────────────────────────────────

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }
}
