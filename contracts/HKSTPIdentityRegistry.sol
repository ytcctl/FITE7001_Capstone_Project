// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title HKSTPIdentityRegistry
 * @notice Maps wallet addresses to ONCHAINID identity contracts (ERC-734/735 style).
 *
 * KYC/AML claims are issued off-chain by Trusted Claim Issuers and stored here.
 * Claim Topics:
 *   1 = KYC Verified
 *   2 = Accredited Investor
 *   3 = Jurisdiction Approved (HK / non-sanctioned)
 *   4 = Source of Funds Verified
 *   5 = PEP/Sanctions Clear
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE  — registry owner (HKSTP platform admin)
 *   AGENT_ROLE          — licensed custodians / KYC agents allowed to register/update identities
 */
contract HKSTPIdentityRegistry is AccessControl, Pausable {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    // Claim topic constants
    uint256 public constant CLAIM_KYC_VERIFIED = 1;
    uint256 public constant CLAIM_ACCREDITED_INVESTOR = 2;
    uint256 public constant CLAIM_JURISDICTION_APPROVED = 3;
    uint256 public constant CLAIM_SOURCE_OF_FUNDS = 4;
    uint256 public constant CLAIM_PEP_SANCTIONS_CLEAR = 5;

    /// @dev Identity entry stored for each registered investor wallet
    struct Identity {
        address onchainId;      // ONCHAINID contract address (ERC-734/735) — zero if not using
        string  country;        // ISO-3166 two-letter country code, e.g. "HK"
        bool    registered;
    }

    /// @dev wallet => Identity
    mapping(address => Identity) private _identities;

    /// @dev wallet => claimTopic => verified (claim is active)
    mapping(address => mapping(uint256 => bool)) private _claims;

    /// @dev Set of required claim topics every investor must hold before trading
    uint256[] private _requiredClaimTopics;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event IdentityRegistered(address indexed investor, address indexed onchainId, string country);
    event IdentityRemoved(address indexed investor);
    event IdentityUpdated(address indexed investor, address indexed newOnchainId, string newCountry);
    event ClaimSet(address indexed investor, uint256 indexed topic, bool value);
    event RequiredClaimTopicsSet(uint256[] topics);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);

        // Default required topics: all five must be satisfied
        _requiredClaimTopics = [
            CLAIM_KYC_VERIFIED,
            CLAIM_ACCREDITED_INVESTOR,
            CLAIM_JURISDICTION_APPROVED,
            CLAIM_SOURCE_OF_FUNDS,
            CLAIM_PEP_SANCTIONS_CLEAR
        ];
    }

    // -------------------------------------------------------------------------
    // Identity management (AGENT_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Register a new investor wallet with its ONCHAINID and country.
     * @param investor  Investor's wallet address.
     * @param onchainId Address of the investor's ONCHAINID contract (may be address(0)).
     * @param country   ISO-3166 two-letter country code.
     */
    function registerIdentity(
        address investor,
        address onchainId,
        string calldata country
    ) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(investor != address(0), "HKSTPIdentityRegistry: zero address");
        require(!_identities[investor].registered, "HKSTPIdentityRegistry: already registered");

        _identities[investor] = Identity({
            onchainId: onchainId,
            country:   country,
            registered: true
        });
        emit IdentityRegistered(investor, onchainId, country);
    }

    /**
     * @notice Remove an investor from the registry.
     * @param investor Investor's wallet address.
     */
    function deleteIdentity(address investor) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(_identities[investor].registered, "HKSTPIdentityRegistry: not registered");
        delete _identities[investor];

        // Clear all claims
        for (uint256 i = 0; i < _requiredClaimTopics.length; i++) {
            delete _claims[investor][_requiredClaimTopics[i]];
        }
        emit IdentityRemoved(investor);
    }

    /**
     * @notice Update an investor's ONCHAINID contract address and/or country.
     */
    function updateIdentity(
        address investor,
        address newOnchainId,
        string calldata newCountry
    ) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(_identities[investor].registered, "HKSTPIdentityRegistry: not registered");
        _identities[investor].onchainId = newOnchainId;
        _identities[investor].country   = newCountry;
        emit IdentityUpdated(investor, newOnchainId, newCountry);
    }

    // -------------------------------------------------------------------------
    // Claim management (AGENT_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Set or revoke a KYC/AML claim for an investor.
     * @param investor Investor's wallet address.
     * @param topic    Claim topic (1-5).
     * @param value    true = claim valid, false = claim revoked.
     */
    function setClaim(
        address investor,
        uint256 topic,
        bool value
    ) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(_identities[investor].registered, "HKSTPIdentityRegistry: not registered");
        _claims[investor][topic] = value;
        emit ClaimSet(investor, topic, value);
    }

    // -------------------------------------------------------------------------
    // Required claim topics management (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Replace the list of required claim topics.
     * @param topics Array of claim topic IDs that every investor must hold.
     */
    function setRequiredClaimTopics(uint256[] calldata topics) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requiredClaimTopics = topics;
        emit RequiredClaimTopicsSet(topics);
    }

    // -------------------------------------------------------------------------
    // Pause (DEFAULT_ADMIN_ROLE)
    // -------------------------------------------------------------------------
    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /**
     * @notice Returns true when the investor is registered AND holds all required claims.
     * @param investor Wallet address to check.
     */
    function isVerified(address investor) external view returns (bool) {
        if (!_identities[investor].registered) return false;
        for (uint256 i = 0; i < _requiredClaimTopics.length; i++) {
            if (!_claims[investor][_requiredClaimTopics[i]]) return false;
        }
        return true;
    }

    /// @notice Returns true when the address is registered (regardless of claims).
    function contains(address investor) external view returns (bool) {
        return _identities[investor].registered;
    }

    /// @notice Returns the ONCHAINID contract address for an investor.
    function identity(address investor) external view returns (address) {
        return _identities[investor].onchainId;
    }

    /// @notice Returns the investor's registered country code.
    function investorCountry(address investor) external view returns (string memory) {
        return _identities[investor].country;
    }

    /// @notice Returns whether a specific claim is active for an investor.
    function hasClaim(address investor, uint256 topic) external view returns (bool) {
        return _claims[investor][topic];
    }

    /// @notice Returns the current list of required claim topics.
    function getRequiredClaimTopics() external view returns (uint256[] memory) {
        return _requiredClaimTopics;
    }
}
