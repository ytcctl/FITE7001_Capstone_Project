// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IIdentity
 * @notice Interface for ERC-734/735 ONCHAINID Identity contracts.
 *
 * ERC-734 (Key Management):
 *   - Each identity holds keys categorised by purpose (MANAGEMENT, ACTION, CLAIM, etc.)
 *   - Keys are identified by keccak256(abi.encode(address))
 *
 * ERC-735 (Claim Holder):
 *   - Claims are attestations signed off-chain by Trusted Claim Issuers
 *   - Each claim: (topic, scheme, issuer, signature, data, uri)
 *   - No PII is stored on-chain — only the cryptographic proof that a
 *     Trusted Issuer attested to a fact (e.g. "KYC Verified")
 */
interface IIdentity {
    // ── ERC-734: Key Management ──────────────────────────────────
    // Key purposes
    // 1 = MANAGEMENT — can manage the identity (add/remove keys & claims)
    // 2 = ACTION     — can perform actions on behalf of the identity
    // 3 = CLAIM      — can add/remove claims
    // 4 = ENCRYPTION — encryption key

    struct Key {
        uint256[] purposes;
        uint256   keyType;    // 1 = ECDSA
        bytes32   key;        // keccak256(abi.encode(address))
    }

    event KeyAdded(bytes32 indexed key, uint256 indexed purpose, uint256 indexed keyType);
    event KeyRemoved(bytes32 indexed key, uint256 indexed purpose, uint256 indexed keyType);

    function getKey(bytes32 key) external view returns (uint256[] memory purposes, uint256 keyType, bytes32 keyValue);
    function keyHasPurpose(bytes32 key, uint256 purpose) external view returns (bool);
    function addKey(bytes32 key, uint256 purpose, uint256 keyType) external;
    function removeKey(bytes32 key, uint256 purpose) external;

    // ── ERC-735: Claim Holder ────────────────────────────────────

    struct Claim {
        uint256 topic;        // Claim topic (1=KYC, 2=Accredited, etc.)
        uint256 scheme;       // Signature scheme (1 = ECDSA, 2 = ECDSA+EIP712)
        address issuer;       // Claim issuer contract address
        bytes   signature;    // Issuer's signature over (identity, topic, data)
        bytes   data;         // Opaque claim data (hash, expiry, etc.) — NO PII
        string  uri;          // Off-chain URI for claim details (optional)
    }

    event ClaimAdded(bytes32 indexed claimId, uint256 indexed topic, address indexed issuer);
    event ClaimRemoved(bytes32 indexed claimId, uint256 indexed topic, address indexed issuer);
    event ClaimChanged(bytes32 indexed claimId, uint256 indexed topic, address indexed issuer);

    function getClaim(bytes32 claimId) external view returns (
        uint256 topic,
        uint256 scheme,
        address issuer,
        bytes memory signature,
        bytes memory data,
        string memory uri
    );
    function getClaimIdsByTopic(uint256 topic) external view returns (bytes32[] memory);
    function addClaim(
        uint256 topic,
        uint256 scheme,
        address issuer,
        bytes calldata signature,
        bytes calldata data,
        string calldata uri
    ) external returns (bytes32 claimId);
    function removeClaim(bytes32 claimId) external;
}
