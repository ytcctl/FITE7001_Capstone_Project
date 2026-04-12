// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Nonces.sol";

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
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  EIP-1167 Minimal Proxy Compatible                              │
 * │  Uses initialize() instead of constructor for clone deployment  │
 * │  Overrides ERC-20 name()/symbol() with custom proxy-safe storage│
 * └──────────────────────────────────────────────────────────────────┘
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
 *   DEFAULT_ADMIN_ROLE  — platform admin (HKSTP); manages agents, safe-list, supply cap, threshold
 *   AGENT_ROLE          — licensed custodians; may mint (≤ threshold), burn, freeze addresses
 *   TIMELOCK_MINTER_ROLE — governance timelock; required for mints above mintThreshold
 */
contract HKSTPSecurityToken is ERC20, ERC20Permit, ERC20Votes, AccessControl, Pausable {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant TIMELOCK_MINTER_ROLE = keccak256("TIMELOCK_MINTER_ROLE");

    // ── Supply-cap & tiered minting ─────────────────────────────
    //
    // maxSupply:      hard ceiling on totalSupply (0 = unlimited).
    // mintThreshold:  mints above this amount require TIMELOCK_MINTER_ROLE
    //                 instead of AGENT_ROLE, forcing governance approval
    //                 through HKSTPGovernor → HKSTPTimelock (48 h delay).
    //                 0 = all mints go through AGENT_ROLE only.

    /// @notice Hard cap on total supply (0 = unlimited).
    uint256 public maxSupply;

    /// @notice Mints above this amount require TIMELOCK_MINTER_ROLE (0 = disabled).
    uint256 public mintThreshold;

    // ── EIP-1167 proxy-safe name/symbol storage ─────────────────
    //
    // OZ v5 ERC20 stores name/symbol in the constructor (immutable-style).
    // EIP-1167 clones skip the constructor, so we store them here and
    // override name()/symbol() to return these proxy-safe values.
    string private _proxyName;
    string private _proxySymbol;
    bool   private _initialized;

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
    event MaxSupplySet(uint256 previousCap, uint256 newCap);
    event MintThresholdSet(uint256 previousThreshold, uint256 newThreshold);

    /// @notice ERC-1644 Forced Transfer — emitted when the Custodian/Agent executes
    ///         a court-ordered or liquidator-directed transfer under Cap. 32 S182.
    /// @param controller  The agent who executed the forced transfer.
    /// @param from        Source address (e.g. compromised/lost wallet, or insolvent entity).
    /// @param to          Destination address (e.g. recovered wallet, or liquidator's address).
    /// @param amount      Number of tokens transferred.
    /// @param legalOrderHash  IPFS CID (bytes32) of the encrypted court order / legal instrument.
    /// @param operatorData    Arbitrary operator context (e.g. case reference, nonce).
    event ForcedTransfer(
        address indexed controller,
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes32 legalOrderHash,
        bytes   operatorData
    );

    // -------------------------------------------------------------------------
    // Constructor (backward-compatible + EIP-1167 implementation)
    // -------------------------------------------------------------------------

    /**
     * @dev For direct deployment (backward compat), pass all params and the
     *      contract initialises inline.
     *      For EIP-1167 implementation deployment, pass empty strings for name
     *      and symbol and address(0) for the other params — clones call
     *      initialize() instead.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address identityRegistry_,
        address compliance_,
        address onchainId_,
        address admin
    ) ERC20("", "") ERC20Permit("") {
        // If admin is non-zero this is a direct (non-proxy) deployment
        if (admin != address(0)) {
            _doInitialize(name_, symbol_, identityRegistry_, compliance_, onchainId_, admin);
        }
    }

    // -------------------------------------------------------------------------
    // Initializer (called on each EIP-1167 clone)
    // -------------------------------------------------------------------------

    /**
     * @notice Initialize a cloned HKSTPSecurityToken. Can only be called once.
     */
    function initialize(
        string memory name_,
        string memory symbol_,
        address identityRegistry_,
        address compliance_,
        address onchainId_,
        address admin
    ) external {
        require(!_initialized, "HKSTPSecurityToken: already initialized");
        _doInitialize(name_, symbol_, identityRegistry_, compliance_, onchainId_, admin);
    }

    function _doInitialize(
        string memory name_,
        string memory symbol_,
        address identityRegistry_,
        address compliance_,
        address /* onchainId_ */,
        address admin
    ) internal {
        require(!_initialized, "HKSTPSecurityToken: already initialized");
        require(identityRegistry_ != address(0), "HKSTPSecurityToken: zero registry");
        require(compliance_ != address(0), "HKSTPSecurityToken: zero compliance");
        require(admin != address(0), "HKSTPSecurityToken: zero admin");

        _initialized = true;

        _proxyName   = name_;
        _proxySymbol = symbol_;

        identityRegistry = identityRegistry_;
        compliance       = compliance_;
        onchainId        = address(0);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // ERC-20 name/symbol overrides (EIP-1167 proxy-safe)
    // -------------------------------------------------------------------------

    function name() public view virtual override returns (string memory) {
        return _proxyName;
    }

    function symbol() public view virtual override returns (string memory) {
        return _proxySymbol;
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
    // Supply cap & tiered minting (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Set the hard cap on total supply (0 = unlimited).
     *         Cannot be set below the current totalSupply.
     * @param cap New max supply in token base units.
     */
    function setMaxSupply(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            cap == 0 || cap >= totalSupply(),
            "HKSTPSecurityToken: cap below current supply"
        );
        emit MaxSupplySet(maxSupply, cap);
        maxSupply = cap;
    }

    /**
     * @notice Set the mint-threshold.  Mints with `amount > mintThreshold`
     *         require TIMELOCK_MINTER_ROLE (governance approval) instead of
     *         the regular AGENT_ROLE.  Set to 0 to disable the threshold
     *         (all mints go through AGENT_ROLE only).
     * @param threshold Amount in token base units.
     */
    function setMintThreshold(uint256 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit MintThresholdSet(mintThreshold, threshold);
        mintThreshold = threshold;
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
    // Minting / Burning (AGENT_ROLE / TIMELOCK_MINTER_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Mint tokens to a verified investor.
     *
     *         Supply-cap guard:
     *           If maxSupply > 0, totalSupply() + amount must not exceed maxSupply.
     *
     *         Tiered minting guard:
     *           If mintThreshold > 0 and amount > mintThreshold, the caller must
     *           hold TIMELOCK_MINTER_ROLE (governance-approved mint via Timelock)
     *           instead of AGENT_ROLE.
     *           Mints ≤ mintThreshold (or when threshold is 0) require AGENT_ROLE.
     *
     * @param to     Recipient (must be registered and verified in Identity Registry).
     *                Must not be the caller (self-dealing prevention).
     * @param amount Amount to mint.
     */
    function mint(address to, uint256 amount) external whenNotPaused {
        // ── Self-dealing prevention ─────────────────────────────
        require(to != msg.sender, "HKSTPSecurityToken: cannot mint to caller");

        // ── Tiered role check ───────────────────────────────────
        if (mintThreshold > 0 && amount > mintThreshold) {
            require(
                hasRole(TIMELOCK_MINTER_ROLE, msg.sender),
                "HKSTPSecurityToken: large mint requires TIMELOCK_MINTER_ROLE"
            );
        } else {
            require(
                hasRole(AGENT_ROLE, msg.sender),
                "HKSTPSecurityToken: caller is not AGENT_ROLE"
            );
        }

        // ── Supply cap check ────────────────────────────────────
        require(
            maxSupply == 0 || totalSupply() + amount <= maxSupply,
            "HKSTPSecurityToken: mint would exceed max supply"
        );

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
    // ERC-1644 Forced Transfer (AGENT_ROLE — Custodian / Liquidator directive)
    // -------------------------------------------------------------------------

    /**
     * @notice ERC-1644 `controllerTransfer` — Forced transfer of tokens by the
     *         licensed Custodian (Agent) acting on a court order or liquidator
     *         directive under Cap. 32 S182.
     *
     *         This is an ATOMIC operation: tokens move directly from `from` to `to`
     *         without intermediate minting or burning, so `totalSupply` is invariant
     *         and the Cap Table remains perfectly consistent.
     *
     *         The encrypted court order is hashed into an IPFS CID and anchored
     *         on-chain via `legalOrderHash`, achieving Immutable Legal Anchoring.
     *
     *         Because a private platform does not automatically qualify for statutory
     *         protection under Cap. 584 (Settlement Finality), contractual finality
     *         is embedded within the Terms of Service and enforced by this function.
     *
     * @dev    Bypasses freeze checks and compliance modules — the Custodian is
     *         assumed to have completed off-chain legal verification.  The frozen
     *         status of `from` is NOT checked because the court order overrides
     *         any platform-level restriction.
     *
     * @param from            Source address (lost wallet, insolvent entity).
     * @param to              Destination address (recovered wallet, liquidator).
     *                        Must be registered and verified in the Identity Registry.
     *                        Must not be the caller (self-dealing prevention).
     * @param amount          Number of tokens to transfer.
     * @param legalOrderHash  bytes32 IPFS CID of the encrypted court order document.
     *                        Must not be zero — every forced transfer must have a
     *                        legal instrument reference for audit purposes.
     * @param operatorData    Arbitrary bytes for operator context (case reference,
     *                        internal nonce, etc.).  May be empty.
     */
    function forcedTransfer(
        address from,
        address to,
        uint256 amount,
        bytes32 legalOrderHash,
        bytes calldata operatorData
    ) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(from != address(0), "HKSTPSecurityToken: from is zero address");
        require(to   != address(0), "HKSTPSecurityToken: to is zero address");
        require(to   != msg.sender, "HKSTPSecurityToken: cannot force-transfer to caller");
        require(amount > 0,         "HKSTPSecurityToken: zero amount");
        require(legalOrderHash != bytes32(0), "HKSTPSecurityToken: missing legal order hash");
        require(
            balanceOf(from) >= amount,
            "HKSTPSecurityToken: insufficient balance"
        );
        require(
            IIdentityRegistry(identityRegistry).isVerified(to),
            "HKSTPSecurityToken: recipient not verified"
        );

        // Atomic transfer: _update is called once (from → to).
        // We temporarily safe-list both addresses so the compliance-aware
        // _update hook does NOT revert — the court order overrides compliance.
        // We also temporarily unfreeze both addresses — court orders override
        // any administrative freeze that may be in place.
        bool wasSafeFrom = safeListed[from];
        bool wasSafeTo   = safeListed[to];
        bool wasFrozenFrom = frozen[from];
        bool wasFrozenTo   = frozen[to];
        safeListed[from] = true;
        safeListed[to]   = true;
        frozen[from] = false;
        frozen[to]   = false;

        _update(from, to, amount);

        // Restore original safe-list and freeze status
        safeListed[from] = wasSafeFrom;
        safeListed[to]   = wasSafeTo;
        frozen[from] = wasFrozenFrom;
        frozen[to]   = wasFrozenTo;

        emit ForcedTransfer(msg.sender, from, to, amount, legalOrderHash, operatorData);
    }

    /**
     * @notice ERC-1644 `isControllable` — signals that this token supports
     *         controller-initiated forced transfers.
     * @return True — the Custodian (AGENT_ROLE) can always execute forced transfers.
     */
    function isControllable() external pure returns (bool) {
        return true;
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
    ) internal virtual override(ERC20, ERC20Votes) whenNotPaused {
        // Mint/burn operations: skip investor checks for address(0)
        if (from != address(0) && to != address(0)) {
            require(!frozen[from], "HKSTPSecurityToken: sender is frozen");
            require(!frozen[to],   "HKSTPSecurityToken: recipient is frozen");

            // Safe-listed operational addresses (OrderBook escrow, treasury,
            // custody) bypass their OWN compliance attestation.  If BOTH sides
            // are safe-listed the entire compliance pipeline is skipped.
            bool fromSafe = safeListed[from];
            bool toSafe   = safeListed[to];

            if (!(fromSafe && toSafe)) {
                IIdentityRegistry registry = IIdentityRegistry(identityRegistry);

                // Non-safe-listed parties must be registered and KYC-verified
                if (!fromSafe) {
                    require(
                        registry.isVerified(from),
                        "HKSTPSecurityToken: sender not verified"
                    );
                }
                if (!toSafe) {
                    require(
                        registry.isVerified(to),
                        "HKSTPSecurityToken: recipient not verified"
                    );
                }

                // Compliance module checks use the real addresses.
                // For a safe-listed party we use a neutral country "XX" to
                // ensure jurisdiction checks don't block escrow flows.
                bytes2 fromCountry;
                bytes2 toCountry;
                if (!fromSafe) {
                    fromCountry = _toBytes2(registry.investorCountry(from));
                } else {
                    fromCountry = bytes2("XX");
                }
                if (!toSafe) {
                    toCountry = _toBytes2(registry.investorCountry(to));
                } else {
                    toCountry = bytes2("XX");
                }

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
    // ERC-165 support + ERC20Permit/Nonces override resolution
    // -------------------------------------------------------------------------

    /**
     * @dev Override nonces to resolve ERC20Permit / Nonces linearization conflict.
     */
    function nonces(address owner)
        public
        view
        override(ERC20Permit, Nonces)
        returns (uint256)
    {
        return super.nonces(owner);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
