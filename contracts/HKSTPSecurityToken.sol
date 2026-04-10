// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// -------------------------------------------------------------------------
// External interface declarations (T-REX compatible)
// -------------------------------------------------------------------------

/// @dev Minimal interface for HKSTPIdentityRegistry
interface IIdentityRegistry {
    function isVerified(address investor) external view returns (bool);
    function investorCountry(address investor) external view returns (string memory);
    function getIdentityForWallet(address wallet) external view returns (address);
    function getLinkedWallets(address identityAddr) external view returns (address[] memory);
}

/// @dev Minimal interface for HKSTPCompliance
interface ICompliance {
    function checkModules(
        address from,
        address to,
        uint256 amount,
        uint256 toBalance,
        bytes2  fromCountry,
        bytes2  toCountry
    ) external view returns (bool ok, string memory reason);
}

/**
 * @title HKSTPSecurityToken
 * @notice ERC-3643 (T-REX) inspired security token — one token per HKSTP portfolio startup.
 *
 * Key design decisions:
 *   - Compliance-aware transfer control: every transfer must pass Identity Registry
 *     and Compliance Contract checks before execution.
 *   - Safe-list for operational addresses (treasury, custody, escrow) that bypass
 *     per-transfer compliance attestation.
 *   - Agent-controlled minting/burning (only licensed custodians with AGENT_ROLE).
 *   - Emergency pause functionality.
 *   - Frozen address management.
 *   - Full audit-trail events.
 *
 * Access Control roles:
 *   DEFAULT_ADMIN_ROLE  — platform admin (HKSTP); manages agents and safe-list
 *   AGENT_ROLE          — licensed custodians; may mint, burn, freeze addresses
 */
contract HKSTPSecurityToken is ERC20, AccessControl, Pausable {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    /// @notice Address of the linked Identity Registry contract.
    address public identityRegistry;

    /// @notice Address of the linked Compliance contract.
    address public compliance;

    /// @notice ONCHAINID contract address for this token.
    address public onchainId;

    /// @dev Safe-listed operational addresses (treasury, escrow, custody) — bypass attestation.
    mapping(address => bool) public safeListed;

    /// @dev Frozen investor addresses — all transfers blocked.
    mapping(address => bool) public frozen;

    // ── Cap. 622 shareholder cap (identity-based) ───────────────
    //
    // Hong Kong Companies Ordinance Cap. 622 limits private companies
    // to 50 shareholders.  We count **unique ONCHAINID identities** with
    // a non-zero aggregate balance (summed across all linked wallets),
    // preventing Sybil attacks where one person splits holdings across
    // multiple wallets to evade the cap.

    /// @notice Maximum number of unique identity-holders (0 = unlimited).
    uint256 public maxShareholders;

    /// @dev Set of unique identity addresses that currently hold tokens.
    address[] private _identityHolders;

    /// @dev identityAddr => index+1 in _identityHolders (0 = not present).
    mapping(address => uint256) private _identityHolderIndex;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event IdentityRegistrySet(address indexed previous, address indexed current);
    event ComplianceSet(address indexed previous, address indexed current);
    event SafeListUpdated(address indexed account, bool status);
    event AddressFrozen(address indexed account, bool isFrozen, address indexed agent);
    event TokensMinted(address indexed to, uint256 amount, address indexed agent);
    event TokensBurned(address indexed from, uint256 amount, address indexed agent);
    event RecoverySuccess(address indexed lost, address indexed recovered, address indexed onchainId);
    event MaxShareholdersSet(uint256 maxShareholders);
    event IdentityHolderAdded(address indexed identityContract);
    event IdentityHolderRemoved(address indexed identityContract);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param name_             Token name (e.g. "HKSTP Startup Alpha Token").
     * @param symbol_           Token symbol (e.g. "HKSA").
     * @param identityRegistry_ Address of the HKSTPIdentityRegistry contract.
     * @param compliance_       Address of the HKSTPCompliance contract.
     * @param onchainId_        ONCHAINID contract address for this token (may be address(0)).
     * @param admin             Initial admin and agent.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address identityRegistry_,
        address compliance_,
        address onchainId_,
        address admin
    ) ERC20(name_, symbol_) {
        require(identityRegistry_ != address(0), "HKSTPSecurityToken: zero registry");
        require(compliance_ != address(0), "HKSTPSecurityToken: zero compliance");
        require(admin != address(0), "HKSTPSecurityToken: zero admin");

        identityRegistry = identityRegistry_;
        compliance       = compliance_;
        onchainId        = onchainId_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // Registry / Compliance updates (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Update the Identity Registry linked to this token.
     * @param newRegistry Address of the new HKSTPIdentityRegistry.
     */
    function setIdentityRegistry(address newRegistry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newRegistry != address(0), "HKSTPSecurityToken: zero address");
        emit IdentityRegistrySet(identityRegistry, newRegistry);
        identityRegistry = newRegistry;
    }

    /**
     * @notice Update the Compliance contract linked to this token.
     * @param newCompliance Address of the new HKSTPCompliance.
     */
    function setCompliance(address newCompliance) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newCompliance != address(0), "HKSTPSecurityToken: zero address");
        emit ComplianceSet(compliance, newCompliance);
        compliance = newCompliance;
    }

    // -------------------------------------------------------------------------
    // Cap. 622 shareholder cap (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Set the maximum number of unique identity-holders for this token.
     *         Cap. 622 limits private companies to 50 shareholders.
     *         Set to 0 to disable the cap.
     * @param cap Maximum unique identity-holders allowed.
     */
    function setMaxShareholders(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxShareholders = cap;
        emit MaxShareholdersSet(cap);
    }

    /**
     * @notice Returns the current number of unique identity-holders.
     */
    function shareholderCount() external view returns (uint256) {
        return _identityHolders.length;
    }

    /**
     * @notice Returns all current identity-holder addresses.
     */
    function getIdentityHolders() external view returns (address[] memory) {
        return _identityHolders;
    }

    /**
     * @notice Returns the aggregate token balance across all wallets linked
     *         to the given identity contract.
     * @param identityAddr The ONCHAINID Identity contract address.
     */
    function aggregateBalanceByIdentity(address identityAddr) public view returns (uint256) {
        IIdentityRegistry registry = IIdentityRegistry(identityRegistry);
        address[] memory wallets = registry.getLinkedWallets(identityAddr);
        uint256 total = 0;
        for (uint256 i = 0; i < wallets.length; i++) {
            total += balanceOf(wallets[i]);
        }
        return total;
    }

    // -------------------------------------------------------------------------
    // Safe-list management (AGENT_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Add or remove an operational address from the safe-list.
     *         Safe-listed addresses (e.g. treasury, escrow, custody) bypass
     *         per-transfer compliance attestation checks.
     * @param account Wallet to update.
     * @param status  true = add to safe-list, false = remove.
     */
    function setSafeList(address account, bool status) external onlyRole(AGENT_ROLE) {
        safeListed[account] = status;
        emit SafeListUpdated(account, status);
    }

    // -------------------------------------------------------------------------
    // Freeze management (AGENT_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Freeze or unfreeze an address.  Frozen addresses cannot send or receive tokens.
     * @param account  Target wallet.
     * @param isFrozen true = freeze, false = unfreeze.
     */
    function setAddressFrozen(address account, bool isFrozen) external onlyRole(AGENT_ROLE) {
        frozen[account] = isFrozen;
        emit AddressFrozen(account, isFrozen, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Minting / Burning (AGENT_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Mint tokens to a verified investor.
     * @param to     Recipient (must be registered and verified in Identity Registry).
     * @param amount Amount to mint.
     */
    function mint(address to, uint256 amount) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(
            IIdentityRegistry(identityRegistry).isVerified(to),
            "HKSTPSecurityToken: recipient not verified"
        );
        require(!frozen[to], "HKSTPSecurityToken: recipient is frozen");
        _mint(to, amount);
        emit TokensMinted(to, amount, msg.sender);
    }

    /**
     * @notice Burn tokens from an address (forced redemption by agent).
     * @param from   Address to burn from.
     * @param amount Amount to burn.
     */
    function burn(address from, uint256 amount) external onlyRole(AGENT_ROLE) whenNotPaused {
        _burn(from, amount);
        emit TokensBurned(from, amount, msg.sender);
    }

    // -------------------------------------------------------------------------
    // Pause (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /// @notice Pause all token transfers.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }

    /// @notice Unpause token transfers.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // -------------------------------------------------------------------------
    // ERC-20 transfer override — compliance-aware
    // -------------------------------------------------------------------------

    /**
     * @dev Hook called before every mint, burn, and transfer.
     *      Enforces:
     *        1. Pause check.
     *        2. Freeze check on sender and recipient.
     *        3. Compliance checks unless both parties are safe-listed.
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override whenNotPaused {
        // Mint/burn operations: skip investor checks for address(0)
        if (from != address(0) && to != address(0)) {
            require(!frozen[from], "HKSTPSecurityToken: sender is frozen");
            require(!frozen[to],   "HKSTPSecurityToken: recipient is frozen");

            // Safe-listed operational addresses bypass compliance pipeline
            bool safeTransfer = safeListed[from] && safeListed[to];

            if (!safeTransfer) {
                // Both parties must be registered and verified
                IIdentityRegistry registry = IIdentityRegistry(identityRegistry);
                require(
                    registry.isVerified(from),
                    "HKSTPSecurityToken: sender not verified"
                );
                require(
                    registry.isVerified(to),
                    "HKSTPSecurityToken: recipient not verified"
                );

                // Derive country codes from registry
                string memory fromCountryStr = registry.investorCountry(from);
                string memory toCountryStr   = registry.investorCountry(to);
                bytes2 fromCountry = _toBytes2(fromCountryStr);
                bytes2 toCountry   = _toBytes2(toCountryStr);

                // Post-transfer balance of recipient
                uint256 toBalance = balanceOf(to) + amount;

                // Module checks: concentration cap, jurisdiction, lock-up
                (bool ok, string memory reason) = ICompliance(compliance).checkModules(
                    from, to, amount, toBalance, fromCountry, toCountry
                );
                require(ok, reason);
            }
        }

        super._update(from, to, amount);

        // ── Post-transfer: update identity-holder tracking ──────
        _updateIdentityHolders(from, to);
    }

    /**
     * @dev After a transfer/mint/burn, update the set of unique identity holders.
     *      - If `to` is a new identity with no prior aggregate balance → add to set.
     *      - If `from`'s identity now has zero aggregate balance → remove from set.
     *      Enforces maxShareholders cap AFTER adding (reverts if breached).
     */
    function _updateIdentityHolders(address from, address to) internal {
        IIdentityRegistry registry = IIdentityRegistry(identityRegistry);
        bool newHolderAdded = false;

        // Handle recipient (mint or transfer-in)
        if (to != address(0)) {
            address toIdentity = registry.getIdentityForWallet(to);
            if (toIdentity != address(0) && _identityHolderIndex[toIdentity] == 0) {
                // Check if this identity truly has a balance now (it should after super._update)
                if (aggregateBalanceByIdentity(toIdentity) > 0) {
                    _identityHolders.push(toIdentity);
                    _identityHolderIndex[toIdentity] = _identityHolders.length; // index+1
                    newHolderAdded = true;
                    emit IdentityHolderAdded(toIdentity);
                }
            }
        }

        // Handle sender (burn or transfer-out)
        if (from != address(0)) {
            address fromIdentity = registry.getIdentityForWallet(from);
            if (fromIdentity != address(0) && _identityHolderIndex[fromIdentity] != 0) {
                if (aggregateBalanceByIdentity(fromIdentity) == 0) {
                    _removeIdentityHolder(fromIdentity);
                    emit IdentityHolderRemoved(fromIdentity);
                }
            }
        }

        // Enforce Cap. 622 shareholder cap
        if (newHolderAdded && maxShareholders != 0) {
            require(
                _identityHolders.length <= maxShareholders,
                "HKSTPSecurityToken: shareholder cap exceeded (Cap. 622)"
            );
        }
    }

    /**
     * @dev Remove an identity from the holder set using swap-and-pop.
     */
    function _removeIdentityHolder(address identityAddr) internal {
        uint256 idx = _identityHolderIndex[identityAddr] - 1; // convert to 0-based
        uint256 lastIdx = _identityHolders.length - 1;

        if (idx != lastIdx) {
            address lastIdentity = _identityHolders[lastIdx];
            _identityHolders[idx] = lastIdentity;
            _identityHolderIndex[lastIdentity] = idx + 1; // store as 1-based
        }

        _identityHolders.pop();
        delete _identityHolderIndex[identityAddr];
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /**
     * @dev Convert a two-character country string to bytes2.
     *      Returns bytes2(0) for empty strings.
     */
    function _toBytes2(string memory s) internal pure returns (bytes2) {
        bytes memory b = bytes(s);
        if (b.length == 0) return bytes2(0);
        if (b.length >= 2) return bytes2(abi.encodePacked(b[0], b[1]));
        return bytes2(abi.encodePacked(b[0], bytes1(0)));
    }

    // -------------------------------------------------------------------------
    // ERC-165 support
    // -------------------------------------------------------------------------
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
