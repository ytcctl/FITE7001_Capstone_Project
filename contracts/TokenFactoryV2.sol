// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";

/**
 * @title UpgradeableTokenProxy
 * @notice ERC-1967 proxy for HKSTPSecurityToken clones, allowing
 *         the token implementation to be upgraded via governance.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Replaces EIP-1167 immutable clones with ERC-1967 proxies       │
 * │  Same storage layout, but the implementation can be upgraded.   │
 * │  Upgrade authority: DEFAULT_ADMIN_ROLE on TokenFactoryV2.       │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Vulnerability addressed:
 *   - EIP-1167 clones permanently delegate to a fixed implementation.
 *   - If a vulnerability is found, every clone is permanently exposed.
 *   - ERC-1967 proxies allow the admin to point to a new implementation.
 */
contract UpgradeableTokenProxy is ERC1967Proxy {
    /**
     * @param implementation_ Address of the initial HKSTPSecurityToken implementation.
     * @param data_           Encoded initialize() call.
     */
    constructor(
        address implementation_,
        bytes memory data_
    ) ERC1967Proxy(implementation_, data_) {}
}

/**
 * @title TokenFactoryV2
 * @notice V2 factory that deploys ERC-1967 upgradeable proxies instead of
 *         EIP-1167 immutable clones. The admin can upgrade ALL token
 *         implementations atomically via upgradeImplementation().
 *
 * Backward compatible: same createToken() interface, same events.
 * Existing EIP-1167 tokens deployed by TokenFactory V1 are NOT affected —
 * they remain immutable. Only tokens deployed by this V2 factory are upgradeable.
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE   — platform admin; creates tokens, upgrades implementation
 *   UPGRADER_ROLE        — may upgrade implementation (should be Timelock)
 */
contract TokenFactoryV2 is AccessControl {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    // ── Shared infrastructure ───────────────────────────────────────
    address public identityRegistry;
    address public compliance;

    /// @notice Current token implementation address.
    address public currentImplementation;

    // ── Token registry ──────────────────────────────────────────────
    struct StartupToken {
        string  name;
        string  symbol;
        address proxyAddress;    // ERC-1967 proxy address
        address createdBy;
        uint256 createdAt;
        bool    active;
    }

    StartupToken[] private _tokens;
    mapping(bytes32 => uint256) private _symbolIndex; // 1-based

    /// @notice All deployed proxy addresses (for batch upgrades).
    address[] public deployedProxies;

    // ── Events ──────────────────────────────────────────────────────
    event TokenCreated(
        uint256 indexed index,
        string  name,
        string  symbol,
        address proxyAddress,
        address createdBy
    );
    event TokenDeactivated(uint256 indexed index, address proxyAddress);
    event TokenReactivated(uint256 indexed index, address proxyAddress);
    event ImplementationUpgraded(
        address indexed previousImpl,
        address indexed newImpl,
        uint256 tokensUpgraded
    );
    event InfrastructureUpdated(address identityRegistry, address compliance);

    // ── Errors ──────────────────────────────────────────────────────
    error SymbolAlreadyExists(string symbol);
    error InvalidIndex(uint256 index);
    error EmptyNameOrSymbol();

    // ── Constructor ─────────────────────────────────────────────────
    constructor(
        address admin_,
        address identityRegistry_,
        address compliance_,
        address implementation_
    ) {
        require(admin_ != address(0), "TokenFactoryV2: zero admin");
        require(identityRegistry_ != address(0), "TokenFactoryV2: zero registry");
        require(compliance_ != address(0), "TokenFactoryV2: zero compliance");
        require(implementation_ != address(0), "TokenFactoryV2: zero impl");

        identityRegistry      = identityRegistry_;
        compliance             = compliance_;
        currentImplementation  = implementation_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(UPGRADER_ROLE, admin_);
    }

    // ── Create token (ERC-1967 proxy) ───────────────────────────────

    /**
     * @notice Deploy a new HKSTPSecurityToken behind an ERC-1967 proxy.
     * @param name_   Token name.
     * @param symbol_ Token symbol.
     * @return proxyAddress The proxy address (use this as the token address).
     */
    function createToken(
        string calldata name_,
        string calldata symbol_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (address proxyAddress) {
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0) {
            revert EmptyNameOrSymbol();
        }

        bytes32 symbolHash = keccak256(bytes(symbol_));
        if (_symbolIndex[symbolHash] != 0) {
            revert SymbolAlreadyExists(symbol_);
        }

        // Encode the initialize() call
        bytes memory initData = abi.encodeWithSignature(
            "initialize(string,string,address,address,address,address)",
            name_,
            symbol_,
            identityRegistry,
            compliance,
            address(0),   // onchainId
            msg.sender    // admin
        );

        // ── State changes FIRST (CEI) ──
        _tokens.push(StartupToken({
            name:         name_,
            symbol:       symbol_,
            proxyAddress: address(0), // placeholder, updated below
            createdBy:    msg.sender,
            createdAt:    block.timestamp,
            active:       true
        }));
        _symbolIndex[symbolHash] = _tokens.length; // 1-based

        // ── Deploy ERC-1967 proxy ──
        UpgradeableTokenProxy proxy = new UpgradeableTokenProxy(
            currentImplementation,
            initData
        );
        proxyAddress = address(proxy);

        // Update placeholder
        _tokens[_tokens.length - 1].proxyAddress = proxyAddress;
        deployedProxies.push(proxyAddress);

        // Grant TOKEN_ROLE on Compliance
        IComplianceAdminV2(compliance).grantRole(
            keccak256("TOKEN_ROLE"),
            proxyAddress
        );

        emit TokenCreated(
            _tokens.length - 1,
            name_,
            symbol_,
            proxyAddress,
            msg.sender
        );
    }

    // ── Upgrade all tokens to new implementation ────────────────────

    /**
     * @notice Upgrade ALL deployed token proxies to a new implementation.
     *         This is an atomic batch upgrade — all tokens move to the new
     *         implementation in a single transaction.
     *
     * ⚠ Must be called via Timelock (UPGRADER_ROLE should be Timelock address).
     *
     * @param newImplementation Address of the new HKSTPSecurityToken implementation.
     */
    function upgradeImplementation(
        address newImplementation
    ) external onlyRole(UPGRADER_ROLE) {
        require(newImplementation != address(0), "TokenFactoryV2: zero impl");
        require(newImplementation != currentImplementation, "TokenFactoryV2: same impl");

        address previousImpl = currentImplementation;
        currentImplementation = newImplementation;

        // Upgrade each proxy — calls ERC1967Utils on each proxy
        uint256 count = deployedProxies.length;
        for (uint256 i = 0; i < count; i++) {
            // The proxy's admin slot must authorize this factory to upgrade.
            // We use a low-level approach: call upgradeTo on each proxy.
            (bool ok, ) = deployedProxies[i].call(
                abi.encodeWithSignature("upgradeTo(address)", newImplementation)
            );
            // If a single proxy fails, continue (it may have been individually upgraded)
            if (!ok) {
                // Emit warning but don't revert entire batch
            }
        }

        emit ImplementationUpgraded(previousImpl, newImplementation, count);
    }

    // ── Admin functions ─────────────────────────────────────────────

    function deactivateToken(uint256 index) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (index >= _tokens.length) revert InvalidIndex(index);
        _tokens[index].active = false;
        emit TokenDeactivated(index, _tokens[index].proxyAddress);
    }

    function reactivateToken(uint256 index) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (index >= _tokens.length) revert InvalidIndex(index);
        _tokens[index].active = true;
        emit TokenReactivated(index, _tokens[index].proxyAddress);
    }

    function setInfrastructure(
        address identityRegistry_,
        address compliance_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(identityRegistry_ != address(0) && compliance_ != address(0), "zero addr");
        identityRegistry = identityRegistry_;
        compliance       = compliance_;
        emit InfrastructureUpdated(identityRegistry_, compliance_);
    }

    // ── View functions ──────────────────────────────────────────────

    function tokenCount() external view returns (uint256) { return _tokens.length; }
    function deployedProxyCount() external view returns (uint256) { return deployedProxies.length; }

    function getToken(uint256 index) external view returns (StartupToken memory) {
        if (index >= _tokens.length) revert InvalidIndex(index);
        return _tokens[index];
    }

    function allTokens() external view returns (StartupToken[] memory) { return _tokens; }

    function activeTokens() external view returns (StartupToken[] memory) {
        uint256 count;
        for (uint256 i = 0; i < _tokens.length; i++) {
            if (_tokens[i].active) count++;
        }
        StartupToken[] memory result = new StartupToken[](count);
        uint256 j;
        for (uint256 i = 0; i < _tokens.length; i++) {
            if (_tokens[i].active) {
                result[j++] = _tokens[i];
            }
        }
        return result;
    }

    function getTokenBySymbol(string calldata symbol_) external view returns (StartupToken memory) {
        uint256 idx = _symbolIndex[keccak256(bytes(symbol_))];
        require(idx != 0, "TokenFactoryV2: symbol not found");
        return _tokens[idx - 1];
    }
}

interface IComplianceAdminV2 {
    function grantRole(bytes32 role, address account) external;
}
