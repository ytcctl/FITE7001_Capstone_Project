// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./identity/IIdentity.sol";
import "./identity/IClaimIssuer.sol";

/**
 * @title HKSTPIdentityRegistry
 * @notice Maps wallet addresses to per-investor ONCHAINID Identity contracts
 *         (ERC-734/735). Each investor owns their own Identity contract which
 *         holds cryptographic claims signed by Trusted Claim Issuers.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  NO PERSONAL IDENTIFIABLE INFORMATION (PII) IS STORED ON-CHAIN  │
 * │  Only boolean claim attestations & cryptographic signatures.     │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Architecture:
 *   1. Agent calls registerIdentity(investor, country)
 *      → IdentityFactory deploys a new Identity contract for the investor
 *      → The investor's wallet is the MANAGEMENT key (ERC-734)
 *      → The agent is added as a CLAIM key (can add claims on behalf)
 *
 *   2. Agent calls issueClaim(investor, topic, signature, data)
 *      → Adds a signed ERC-735 claim to the investor's Identity contract
 *      → The signature proves a Trusted Claim Issuer attested to a fact
 *        (e.g. "KYC Verified") without revealing the underlying documents
 *
 *   3. At transfer time, isVerified(investor) checks:
 *      → The investor is registered
 *      → For each required claim topic, the Identity contract holds a valid
 *        claim signed by one of the Trusted Claim Issuers, and the claim
 *        is not expired and not revoked
 *
 * Claim Topics (ERC-735):
 *   1 = KYC Verified
 *   2 = Accredited Investor
 *   3 = Jurisdiction Approved (HK / non-sanctioned)
 *   4 = Source of Funds Verified
 *   5 = PEP/Sanctions Clear
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE  — registry owner (HKSTP platform admin)
 *   AGENT_ROLE          — licensed custodians / KYC agents
 */
contract HKSTPIdentityRegistry is AccessControl, Pausable {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    // Claim topic constants
    uint256 public constant CLAIM_KYC_VERIFIED = 1;
    uint256 public constant CLAIM_ACCREDITED_INVESTOR = 2;
    uint256 public constant CLAIM_JURISDICTION_APPROVED = 3;
    uint256 public constant CLAIM_SOURCE_OF_FUNDS = 4;
    uint256 public constant CLAIM_PEP_SANCTIONS_CLEAR = 5;

    // ── Investor identity entry ─────────────────────────────────
    struct InvestorIdentity {
        address identityContract;  // Per-investor ONCHAINID (ERC-734/735)
        string  country;           // ISO-3166 two-letter code, e.g. "HK"
        bool    registered;
    }

    /// @dev wallet => InvestorIdentity
    mapping(address => InvestorIdentity) private _identities;

    /// @dev Backward-compatible boolean claims (used alongside ONCHAINID claims)
    mapping(address => mapping(uint256 => bool)) private _claims;

    /// @dev Set of required claim topics
    uint256[] private _requiredClaimTopics;

    // ── ONCHAINID infrastructure ────────────────────────────────

    /// @notice The IdentityFactory that deploys per-investor Identity contracts.
    address public identityFactory;

    /// @notice Trusted Claim Issuers — issuers whose signatures are accepted.
    address[] private _trustedIssuers;
    mapping(address => bool) public isTrustedIssuer;

    /// @notice Mapping: claimTopic => list of trusted issuer addresses for that topic.
    mapping(uint256 => address[]) private _trustedIssuersByTopic;
    mapping(uint256 => mapping(address => bool)) private _isTrustedForTopic;

    // ── Events ──────────────────────────────────────────────────
    event IdentityRegistered(address indexed investor, address indexed identityContract, string country);
    event IdentityRemoved(address indexed investor);
    event IdentityUpdated(address indexed investor, address indexed newIdentityContract, string newCountry);
    event ClaimSet(address indexed investor, uint256 indexed topic, bool value);
    event ClaimIssued(address indexed investor, uint256 indexed topic, address indexed issuer, bytes32 claimId);
    event RequiredClaimTopicsSet(uint256[] topics);
    event TrustedIssuerAdded(address indexed issuer, uint256[] topics);
    event TrustedIssuerRemoved(address indexed issuer);
    event IdentityFactorySet(address indexed factory);

    // ── Constructor ─────────────────────────────────────────────
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);

        _requiredClaimTopics = [
            CLAIM_KYC_VERIFIED,
            CLAIM_ACCREDITED_INVESTOR,
            CLAIM_JURISDICTION_APPROVED,
            CLAIM_SOURCE_OF_FUNDS,
            CLAIM_PEP_SANCTIONS_CLEAR
        ];
    }

    // ── Admin: Set infrastructure ───────────────────────────────

    /**
     * @notice Set the IdentityFactory address.
     */
    function setIdentityFactory(address factory) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(factory != address(0), "HKSTPIdentityRegistry: zero factory");
        identityFactory = factory;
        emit IdentityFactorySet(factory);
    }

    /**
     * @notice Add a Trusted Claim Issuer for specified topics.
     * @param issuer The ClaimIssuer contract address.
     * @param topics The claim topics this issuer is trusted for.
     */
    function addTrustedIssuer(
        address issuer,
        uint256[] calldata topics
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(issuer != address(0), "HKSTPIdentityRegistry: zero issuer");
        require(!isTrustedIssuer[issuer], "HKSTPIdentityRegistry: already trusted");

        isTrustedIssuer[issuer] = true;
        _trustedIssuers.push(issuer);

        for (uint256 i = 0; i < topics.length; i++) {
            _trustedIssuersByTopic[topics[i]].push(issuer);
            _isTrustedForTopic[topics[i]][issuer] = true;
        }

        emit TrustedIssuerAdded(issuer, topics);
    }

    /**
     * @notice Remove a Trusted Claim Issuer from all topics.
     */
    function removeTrustedIssuer(address issuer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(isTrustedIssuer[issuer], "HKSTPIdentityRegistry: not trusted");
        isTrustedIssuer[issuer] = false;

        // Remove from _trustedIssuers array
        for (uint256 i = 0; i < _trustedIssuers.length; i++) {
            if (_trustedIssuers[i] == issuer) {
                _trustedIssuers[i] = _trustedIssuers[_trustedIssuers.length - 1];
                _trustedIssuers.pop();
                break;
            }
        }

        // Remove from per-topic arrays
        for (uint256 t = 1; t <= 5; t++) {
            if (_isTrustedForTopic[t][issuer]) {
                _isTrustedForTopic[t][issuer] = false;
                address[] storage issuers = _trustedIssuersByTopic[t];
                for (uint256 i = 0; i < issuers.length; i++) {
                    if (issuers[i] == issuer) {
                        issuers[i] = issuers[issuers.length - 1];
                        issuers.pop();
                        break;
                    }
                }
            }
        }

        emit TrustedIssuerRemoved(issuer);
    }

    // ── Identity management (AGENT_ROLE) ────────────────────────

    /**
     * @notice Register a new investor. If an IdentityFactory is configured,
     *         automatically deploys an ONCHAINID Identity contract.
     * @param investor    Investor's wallet address.
     * @param onchainId   Pre-deployed Identity contract (address(0) to auto-deploy).
     * @param country     ISO-3166 two-letter country code.
     */
    function registerIdentity(
        address investor,
        address onchainId,
        string calldata country
    ) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(investor != address(0), "HKSTPIdentityRegistry: zero address");
        require(!_identities[investor].registered, "HKSTPIdentityRegistry: already registered");

        address identityAddr = onchainId;

        // Auto-deploy Identity contract if factory is set and no onchainId provided
        if (identityAddr == address(0) && identityFactory != address(0)) {
            identityAddr = _IIdentityFactory(identityFactory).deployIdentity(
                investor,
                msg.sender  // agent gets CLAIM key on the new identity
            );
        }

        _identities[investor] = InvestorIdentity({
            identityContract: identityAddr,
            country:          country,
            registered:       true
        });

        emit IdentityRegistered(investor, identityAddr, country);
    }

    /**
     * @notice Remove an investor from the registry.
     */
    function deleteIdentity(address investor) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(_identities[investor].registered, "HKSTPIdentityRegistry: not registered");
        delete _identities[investor];

        for (uint256 i = 0; i < _requiredClaimTopics.length; i++) {
            delete _claims[investor][_requiredClaimTopics[i]];
        }
        emit IdentityRemoved(investor);
    }

    /**
     * @notice Update an investor's Identity contract and/or country.
     */
    function updateIdentity(
        address investor,
        address newOnchainId,
        string calldata newCountry
    ) external onlyRole(AGENT_ROLE) whenNotPaused {
        require(_identities[investor].registered, "HKSTPIdentityRegistry: not registered");
        _identities[investor].identityContract = newOnchainId;
        _identities[investor].country = newCountry;
        emit IdentityUpdated(investor, newOnchainId, newCountry);
    }

    // ── Claim management (AGENT_ROLE) ───────────────────────────

    /**
     * @notice Set/revoke a claim in the backward-compatible boolean storage.
     *         This is the simple path — still works for basic claim tracking.
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

    /**
     * @notice Issue a cryptographic ERC-735 claim on the investor's Identity contract.
     *         The claim is signed off-chain by the Trusted Claim Issuer and stored
     *         on the investor's self-sovereign Identity contract.
     *
     * @param investor   Investor's wallet address.
     * @param topic      Claim topic (1-5).
     * @param issuer     ClaimIssuer contract address.
     * @param signature  Issuer's ECDSA signature over the claim data.
     * @param data       Claim data: abi.encode(identityContract, topic, expiryTimestamp).
     */
    function issueClaim(
        address investor,
        uint256 topic,
        address issuer,
        bytes calldata signature,
        bytes calldata data
    ) external onlyRole(AGENT_ROLE) whenNotPaused {
        InvestorIdentity storage inv = _identities[investor];
        require(inv.registered, "HKSTPIdentityRegistry: not registered");
        require(inv.identityContract != address(0), "HKSTPIdentityRegistry: no identity contract");
        require(isTrustedIssuer[issuer], "HKSTPIdentityRegistry: untrusted issuer");

        bytes32 claimId = IIdentity(inv.identityContract).addClaim(
            topic,
            1,          // scheme = ECDSA
            issuer,
            signature,
            data,
            ""          // uri — optional off-chain reference
        );

        // Also set the boolean claim for backward compatibility
        _claims[investor][topic] = true;

        emit ClaimIssued(investor, topic, issuer, claimId);
    }

    // ── Required claim topics (DEFAULT_ADMIN_ROLE) ──────────────

    function setRequiredClaimTopics(uint256[] calldata topics) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requiredClaimTopics = topics;
        emit RequiredClaimTopicsSet(topics);
    }

    // ── Pause ───────────────────────────────────────────────────
    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // ── View functions ──────────────────────────────────────────

    /**
     * @notice Returns true when the investor is registered AND holds all required claims.
     *
     * Verification logic (dual-mode):
     *   If the investor has an ONCHAINID Identity contract AND trusted issuers are
     *   configured, verification checks the cryptographic claims on the Identity
     *   contract — validating issuer signatures and checking revocation status.
     *
     *   Otherwise, falls back to the boolean claim storage for backward compatibility.
     */
    function isVerified(address investor) external view returns (bool) {
        InvestorIdentity storage inv = _identities[investor];
        if (!inv.registered) return false;

        // If ONCHAINID is set and trusted issuers exist, use cryptographic verification
        if (inv.identityContract != address(0) && _trustedIssuers.length > 0) {
            return _verifyOnchainClaims(inv.identityContract);
        }

        // Fallback: boolean claim check
        return _verifyBooleanClaims(investor);
    }

    /**
     * @dev Verify claims by reading from the investor's Identity contract (ERC-735)
     *      and validating each claim's signature via the ClaimIssuer.
     */
    function _verifyOnchainClaims(address identityContract) internal view returns (bool) {
        for (uint256 i = 0; i < _requiredClaimTopics.length; i++) {
            uint256 topic = _requiredClaimTopics[i];
            if (!_hasValidClaimForTopic(identityContract, topic)) {
                return false;
            }
        }
        return true;
    }

    /**
     * @dev Check if the Identity contract holds at least one valid, non-revoked
     *      claim for the given topic from a trusted issuer.
     */
    function _hasValidClaimForTopic(
        address identityContract,
        uint256 topic
    ) internal view returns (bool) {
        bytes32[] memory claimIds;
        try IIdentity(identityContract).getClaimIdsByTopic(topic) returns (bytes32[] memory ids) {
            claimIds = ids;
        } catch {
            return false;
        }

        for (uint256 i = 0; i < claimIds.length; i++) {
            (
                ,           // topic (already known)
                ,           // scheme
                address issuer,
                bytes memory signature,
                bytes memory data,
                            // uri
            ) = IIdentity(identityContract).getClaim(claimIds[i]);

            // Must be from a trusted issuer for this topic
            if (!_isTrustedForTopic[topic][issuer]) continue;

            // Validate signature via ClaimIssuer contract
            try IClaimIssuer(issuer).isClaimValid(
                identityContract, topic, signature, data
            ) returns (bool valid) {
                if (!valid) continue;
            } catch {
                continue;
            }

            // Check revocation
            try IClaimIssuer(issuer).isClaimRevoked(claimIds[i]) returns (bool revoked) {
                if (revoked) continue;
            } catch {
                continue;
            }

            // Check expiry if data contains it
            if (data.length >= 96) {
                (, , uint256 expiry) = abi.decode(data, (address, uint256, uint256));
                if (expiry != 0 && block.timestamp > expiry) continue;
            }

            return true; // Found a valid claim for this topic
        }
        return false;
    }

    /**
     * @dev Fallback: verify using boolean claims (backward-compatible).
     */
    function _verifyBooleanClaims(address investor) internal view returns (bool) {
        for (uint256 i = 0; i < _requiredClaimTopics.length; i++) {
            if (!_claims[investor][_requiredClaimTopics[i]]) return false;
        }
        return true;
    }

    /// @notice Returns true when the address is registered.
    function contains(address investor) external view returns (bool) {
        return _identities[investor].registered;
    }

    /// @notice Returns the ONCHAINID Identity contract address for an investor.
    function identity(address investor) external view returns (address) {
        return _identities[investor].identityContract;
    }

    /// @notice Returns the investor's country code.
    function investorCountry(address investor) external view returns (string memory) {
        return _identities[investor].country;
    }

    /// @notice Returns whether a boolean claim is active.
    function hasClaim(address investor, uint256 topic) external view returns (bool) {
        return _claims[investor][topic];
    }

    /// @notice Returns the required claim topics.
    function getRequiredClaimTopics() external view returns (uint256[] memory) {
        return _requiredClaimTopics;
    }

    /// @notice Returns all trusted claim issuers.
    function getTrustedIssuers() external view returns (address[] memory) {
        return _trustedIssuers;
    }

    /// @notice Returns trusted issuers for a specific topic.
    function getTrustedIssuersForTopic(uint256 topic) external view returns (address[] memory) {
        return _trustedIssuersByTopic[topic];
    }
}

/// @dev Minimal interface for the IdentityFactory (avoids circular import)
interface _IIdentityFactory {
    function deployIdentity(address investor, address claimAgent) external returns (address);
    function getIdentity(address investor) external view returns (address);
}
