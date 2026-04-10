// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "./IClaimIssuer.sol";

/**
 * @title ClaimIssuer
 * @notice Trusted Claim Issuer contract — issues and validates cryptographic
 *         claims for investor Identity contracts (ERC-735).
 *
 * How it works:
 *   1. The KYC agent verifies an investor's documents OFF-CHAIN (passport,
 *      bank statement, etc.). No PII is stored on-chain.
 *   2. The agent signs a claim: keccak256(abi.encode(identityContract, topic, data))
 *      where data = abi.encode(identityContract, topic, expiryTimestamp).
 *   3. The signed claim is added to the investor's Identity contract via addClaim().
 *   4. At transfer time, the IdentityRegistry calls isClaimValid() on this contract
 *      to verify the signature is from this issuer's signing key.
 *
 * Revocation:
 *   The issuer can revoke any claim by its claimId without touching the
 *   investor's Identity contract — the revocation is checked on validation.
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — can update the signing key and manage revocations
 */
contract ClaimIssuer is IClaimIssuer, AccessControl {
    using ECDSA for bytes32;

    /// @notice The signing key used to issue claims.
    address public signingKey;

    /// @dev claimId => revoked
    mapping(bytes32 => bool) private _revokedClaims;

    event SigningKeyUpdated(address indexed previous, address indexed current);
    event ClaimRevoked(bytes32 indexed claimId);
    event ClaimUnrevoked(bytes32 indexed claimId);

    constructor(address admin, address signingKey_) {
        require(admin != address(0), "ClaimIssuer: zero admin");
        require(signingKey_ != address(0), "ClaimIssuer: zero signing key");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        signingKey = signingKey_;
        emit SigningKeyUpdated(address(0), signingKey_);
    }

    // ── Admin functions ─────────────────────────────────────────

    /**
     * @notice Update the signing key. Only claims signed by the current key
     *         (or previously valid keys, if not revoked) are accepted.
     */
    function setSigningKey(address newKey) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newKey != address(0), "ClaimIssuer: zero key");
        emit SigningKeyUpdated(signingKey, newKey);
        signingKey = newKey;
    }

    /**
     * @notice Revoke a claim by its claimId. The claim remains on the investor's
     *         Identity contract but will fail validation.
     */
    function revokeClaim(bytes32 claimId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokedClaims[claimId] = true;
        emit ClaimRevoked(claimId);
    }

    /**
     * @notice Un-revoke a previously revoked claim.
     */
    function unrevokeClaim(bytes32 claimId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _revokedClaims[claimId] = false;
        emit ClaimUnrevoked(claimId);
    }

    // ── IClaimIssuer implementation ─────────────────────────────

    /// @inheritdoc IClaimIssuer
    function isClaimRevoked(bytes32 claimId) external view override returns (bool) {
        return _revokedClaims[claimId];
    }

    /**
     * @inheritdoc IClaimIssuer
     * @notice Validates that:
     *   1. The signature was produced by this issuer's signing key
     *   2. The signed message matches keccak256(abi.encode(identityContract, topic, data))
     *   3. The claim has not been revoked
     *
     * @param identityContract The investor's Identity contract address.
     * @param topic            Claim topic (1-5).
     * @param sig              ECDSA signature by the signing key.
     * @param data             Opaque claim data, e.g. abi.encode(identity, topic, expiry).
     */
    function isClaimValid(
        address identityContract,
        uint256 topic,
        bytes calldata sig,
        bytes calldata data
    ) external view override returns (bool) {
        // Check revocation
        bytes32 claimId = keccak256(abi.encode(address(this), topic));
        if (_revokedClaims[claimId]) return false;

        // Reconstruct the signed message
        bytes32 dataHash = keccak256(abi.encode(identityContract, topic, data));
        bytes32 ethSignedHash = _toEthSignedMessageHash(dataHash);

        // Recover signer and check
        address recovered = ethSignedHash.recover(sig);
        return recovered == signingKey;
    }

    // ── Helpers ─────────────────────────────────────────────────

    /**
     * @notice Utility: compute the message hash that the signing key must sign
     *         for a given identity + topic + data. Use this off-chain to produce
     *         the signature.
     */
    function getClaimHash(
        address identityContract,
        uint256 topic,
        bytes calldata data
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(identityContract, topic, data));
    }

    function _toEthSignedMessageHash(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }
}
