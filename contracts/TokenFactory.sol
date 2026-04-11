// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./HKSTPSecurityToken.sol";

/**
 * @title TokenFactory
 * @notice Factory contract that allows HKSTP admins to deploy new
 *         HKSTPSecurityToken instances — one per approved startup company —
 *         using EIP-1167 Minimal Proxy (Clone) pattern for gas savings.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  EIP-1167 Minimal Proxy Pattern                                 │
 * │  One HKSTPSecurityToken implementation deployed at construction.│
 * │  Each clone costs ~45 bytes on-chain + a delegatecall stub.     │
 * │  Gas savings: ~90 % per token deployment.                       │
 * └──────────────────────────────────────────────────────────────────┘
 *
 *         Each token is automatically linked to the shared IdentityRegistry
 *         and Compliance contracts, and granted TOKEN_ROLE on Compliance so
 *         it can call canTransfer().
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — HKSTP platform admin; can create new tokens.
 *
 * Usage:
 *   1. Admin calls createToken("TechStartup Alpha Token", "TSTA")
 *   2. Factory deploys a new HKSTPSecurityToken
 *   3. Factory grants TOKEN_ROLE on Compliance to the new token
 *   4. The new token appears in allTokens() and tokensByStartup()
 */
contract TokenFactory is AccessControl {
    using Clones for address;

    // ── Shared infrastructure (set once at deploy time) ─────────────
    address public identityRegistry;
    address public compliance;

    /// @notice Address of the HKSTPSecurityToken implementation (EIP-1167 master copy).
    address public immutable tokenImplementation;

    // ── Token registry ──────────────────────────────────────────────
    struct StartupToken {
        string  name;          // e.g. "TechStartup Alpha Token"
        string  symbol;        // e.g. "TSTA"
        address tokenAddress;  // deployed HKSTPSecurityToken address
        address createdBy;     // admin who created it
        uint256 createdAt;     // block.timestamp
        bool    active;        // can be deactivated later
    }

    StartupToken[] private _tokens;

    /// @notice symbol → token index (1-based; 0 = not found)
    mapping(bytes32 => uint256) private _symbolIndex;

    // ── Events ──────────────────────────────────────────────────────
    event TokenCreated(
        uint256 indexed index,
        string  name,
        string  symbol,
        address tokenAddress,
        address createdBy
    );
    event TokenDeactivated(uint256 indexed index, address tokenAddress);
    event TokenReactivated(uint256 indexed index, address tokenAddress);
    event InfrastructureUpdated(address identityRegistry, address compliance);

    // ── Errors ──────────────────────────────────────────────────────
    error SymbolAlreadyExists(string symbol);
    error InvalidIndex(uint256 index);
    error EmptyNameOrSymbol();

    // ── Constructor ─────────────────────────────────────────────────
    /**
     * @param admin_             Platform admin address.
     * @param identityRegistry_  Shared HKSTPIdentityRegistry address.
     * @param compliance_        Shared HKSTPCompliance address.
     */
    constructor(
        address admin_,
        address identityRegistry_,
        address compliance_
    ) {
        require(admin_ != address(0), "TokenFactory: zero admin");
        require(identityRegistry_ != address(0), "TokenFactory: zero registry");
        require(compliance_ != address(0), "TokenFactory: zero compliance");

        identityRegistry = identityRegistry_;
        compliance       = compliance_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);

        // Deploy the implementation contract (admin = address(0) means it
        // stays uninitialised — clones will call initialize())
        tokenImplementation = address(new HKSTPSecurityToken(
            "", "", address(0), address(0), address(0), address(0)
        ));
    }

    // ── Admin: Create a new startup token ───────────────────────────

    /**
     * @notice Deploy a new HKSTPSecurityToken for an approved startup.
     * @param name_   Token name, e.g. "HKSTP BioTech Beta Token".
     * @param symbol_ Token symbol, e.g. "HKBB".
     * @return tokenAddress The address of the newly deployed token.
     */
    function createToken(
        string calldata name_,
        string calldata symbol_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (address tokenAddress) {
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0) {
            revert EmptyNameOrSymbol();
        }

        bytes32 symbolHash = keccak256(bytes(symbol_));
        if (_symbolIndex[symbolHash] != 0) {
            revert SymbolAlreadyExists(symbol_);
        }

        // Deploy a new security token clone (EIP-1167 minimal proxy)
        address tokenAddress_ = tokenImplementation.clone();
        HKSTPSecurityToken token = HKSTPSecurityToken(tokenAddress_);
        token.initialize(
            name_,
            symbol_,
            identityRegistry,
            compliance,
            address(0),       // onchainId — not used per-token
            msg.sender        // admin of the new token = caller
        );

        tokenAddress = tokenAddress_;

        // Grant TOKEN_ROLE on the Compliance contract so the new token
        // can call canTransfer() / checkModules()
        // NOTE: This requires the TokenFactory itself to have DEFAULT_ADMIN_ROLE
        //       on the Compliance contract (set up during deployment).
        IComplianceAdmin(compliance).grantRole(
            keccak256("TOKEN_ROLE"),
            tokenAddress
        );

        // Register in the factory
        _tokens.push(StartupToken({
            name:         name_,
            symbol:       symbol_,
            tokenAddress: tokenAddress,
            createdBy:    msg.sender,
            createdAt:    block.timestamp,
            active:       true
        }));
        _symbolIndex[symbolHash] = _tokens.length; // 1-based

        emit TokenCreated(_tokens.length - 1, name_, symbol_, tokenAddress, msg.sender);
    }

    // ── Admin: Deactivate / Reactivate ──────────────────────────────

    function deactivateToken(uint256 index) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (index >= _tokens.length) revert InvalidIndex(index);
        _tokens[index].active = false;
        emit TokenDeactivated(index, _tokens[index].tokenAddress);
    }

    function reactivateToken(uint256 index) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (index >= _tokens.length) revert InvalidIndex(index);
        _tokens[index].active = true;
        emit TokenReactivated(index, _tokens[index].tokenAddress);
    }

    // ── Admin: Update shared infrastructure ─────────────────────────

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

    /// @notice Total number of tokens created (including deactivated).
    function tokenCount() external view returns (uint256) {
        return _tokens.length;
    }

    /// @notice Get details of a token by index.
    function getToken(uint256 index) external view returns (StartupToken memory) {
        if (index >= _tokens.length) revert InvalidIndex(index);
        return _tokens[index];
    }

    /// @notice Get all tokens (active + deactivated).
    function allTokens() external view returns (StartupToken[] memory) {
        return _tokens;
    }

    /// @notice Get only active tokens.
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

    /// @notice Look up a token by symbol.
    function getTokenBySymbol(string calldata symbol_) external view returns (StartupToken memory) {
        uint256 idx = _symbolIndex[keccak256(bytes(symbol_))];
        require(idx != 0, "TokenFactory: symbol not found");
        return _tokens[idx - 1];
    }
}

/// @dev Minimal interface to call grantRole on Compliance
interface IComplianceAdmin {
    function grantRole(bytes32 role, address account) external;
}
