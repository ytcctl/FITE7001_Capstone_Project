// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title OracleCommittee
 * @notice 2-of-3 multi-oracle compliance attestation verifier.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Eliminates Single-Oracle Dependency                             │
 * │                                                                  │
 * │  Before: 1 Compliance Oracle key → single point of failure      │
 * │  After:  3 Oracle members → 2-of-3 threshold required           │
 * │                                                                  │
 * │  If 1 oracle key is compromised → attacker cannot forge          │
 * │  attestations (needs 2 valid signatures)                         │
 * │  If 1 oracle is offline → other 2 can still sign                │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Integration:
 *   HKSTPCompliance.sol calls verifyMultiAttestation() instead of
 *   a single ECDSA.recover(). The attestation struct is identical.
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — can add/remove oracle members (via Timelock)
 *   ORACLE_ROLE        — oracle committee member
 */
contract OracleCommittee is AccessControl, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    // EIP-712 type hash (same as HKSTPCompliance)
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256(
            "Attestation(address from,address to,uint256 amount,uint256 expiry,uint256 nonce)"
        );

    /// @notice Minimum number of valid oracle signatures required.
    uint256 public threshold;

    /// @notice Maximum number of oracle members allowed.
    uint256 public constant MAX_ORACLES = 5;

    /// @dev Ordered list of oracle members for enumeration.
    address[] private _oracleMembers;

    /// @dev Tracks consumed attestation hashes (replay protection).
    mapping(bytes32 => bool) public usedAttestations;

    // ── Events ──────────────────────────────────────────────────────
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);
    event OracleMemberAdded(address indexed member);
    event OracleMemberRemoved(address indexed member);
    event MultiAttestationConsumed(
        bytes32 indexed attestHash,
        address indexed from,
        address indexed to,
        uint256 validSignatures
    );

    // ── Constructor ─────────────────────────────────────────────────
    /**
     * @param admin_     Admin address (should be Timelock).
     * @param oracles_   Initial oracle member addresses (2-5 members).
     * @param threshold_ Minimum signatures required (e.g. 2 for 2-of-3).
     */
    constructor(
        address admin_,
        address[] memory oracles_,
        uint256 threshold_
    ) EIP712("HKSTPCompliance", "1") {
        require(admin_ != address(0), "OracleCommittee: zero admin");
        require(oracles_.length >= 2, "OracleCommittee: need >=2 oracles");
        require(oracles_.length <= MAX_ORACLES, "OracleCommittee: too many oracles");
        require(threshold_ >= 2, "OracleCommittee: threshold must be >=2");
        require(threshold_ <= oracles_.length, "OracleCommittee: threshold > members");

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        threshold = threshold_;

        for (uint256 i = 0; i < oracles_.length; i++) {
            require(oracles_[i] != address(0), "OracleCommittee: zero oracle");
            _grantRole(ORACLE_ROLE, oracles_[i]);
            _oracleMembers.push(oracles_[i]);
            emit OracleMemberAdded(oracles_[i]);
        }
    }

    // ── Multi-sig attestation verification ──────────────────────────

    /**
     * @notice Verify that at least `threshold` oracle members have signed
     *         the same attestation.
     *
     * @param from       Sender wallet.
     * @param to         Recipient wallet.
     * @param amount     Token amount.
     * @param expiry     Attestation expiry timestamp.
     * @param nonce      Unique nonce for replay protection.
     * @param signatures Array of EIP-712 signatures from oracle members.
     *                   Must contain at least `threshold` valid signatures.
     * @return true if verification passes.
     */
    function verifyMultiAttestation(
        address from,
        address to,
        uint256 amount,
        uint256 expiry,
        uint256 nonce,
        bytes[] calldata signatures
    ) public view returns (bool) {
        require(signatures.length >= threshold, "OracleCommittee: not enough sigs");
        if (block.timestamp > expiry) return false;

        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, from, to, amount, expiry, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        bytes32 attestHash = keccak256(abi.encode(from, to, amount, expiry, nonce));

        if (usedAttestations[attestHash]) return false;

        // Count unique valid oracle signatures
        uint256 validCount;
        address[] memory seenSigners = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = digest.recover(signatures[i]);

            // Must be an oracle member
            if (!hasRole(ORACLE_ROLE, signer)) continue;

            // Must not be a duplicate signer
            bool duplicate = false;
            for (uint256 j = 0; j < validCount; j++) {
                if (seenSigners[j] == signer) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) continue;

            seenSigners[validCount] = signer;
            validCount++;

            if (validCount >= threshold) return true;
        }

        return false;
    }

    /**
     * @notice Verify AND consume a multi-oracle attestation.
     *         Only callable by addresses with TOKEN_ROLE equivalent (via the caller contract).
     * @return true if valid; reverts if invalid.
     */
    function consumeMultiAttestation(
        address from,
        address to,
        uint256 amount,
        uint256 expiry,
        uint256 nonce,
        bytes[] calldata signatures
    ) external returns (bool) {
        require(block.timestamp <= expiry, "OracleCommittee: attestation expired");
        require(signatures.length >= threshold, "OracleCommittee: not enough sigs");

        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, from, to, amount, expiry, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        bytes32 attestHash = keccak256(abi.encode(from, to, amount, expiry, nonce));

        require(!usedAttestations[attestHash], "OracleCommittee: attestation already used");

        // Validate threshold signatures
        uint256 validCount;
        address[] memory seenSigners = new address[](signatures.length);

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = digest.recover(signatures[i]);
            if (!hasRole(ORACLE_ROLE, signer)) continue;

            bool duplicate = false;
            for (uint256 j = 0; j < validCount; j++) {
                if (seenSigners[j] == signer) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) continue;

            seenSigners[validCount] = signer;
            validCount++;
        }

        require(validCount >= threshold, "OracleCommittee: insufficient valid signatures");

        usedAttestations[attestHash] = true;
        emit MultiAttestationConsumed(attestHash, from, to, validCount);
        return true;
    }

    // ── Admin: Manage oracle members ────────────────────────────────

    function addOracle(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(oracle != address(0), "OracleCommittee: zero address");
        require(!hasRole(ORACLE_ROLE, oracle), "OracleCommittee: already oracle");
        require(_oracleMembers.length < MAX_ORACLES, "OracleCommittee: max oracles");

        _grantRole(ORACLE_ROLE, oracle);
        _oracleMembers.push(oracle);
        emit OracleMemberAdded(oracle);
    }

    function removeOracle(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(hasRole(ORACLE_ROLE, oracle), "OracleCommittee: not oracle");
        require(_oracleMembers.length > threshold, "OracleCommittee: would go below threshold");

        _revokeRole(ORACLE_ROLE, oracle);

        // Remove from array
        for (uint256 i = 0; i < _oracleMembers.length; i++) {
            if (_oracleMembers[i] == oracle) {
                _oracleMembers[i] = _oracleMembers[_oracleMembers.length - 1];
                _oracleMembers.pop();
                break;
            }
        }
        emit OracleMemberRemoved(oracle);
    }

    function setThreshold(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newThreshold >= 2, "OracleCommittee: threshold must be >=2");
        require(newThreshold <= _oracleMembers.length, "OracleCommittee: threshold > members");
        uint256 old = threshold;
        threshold = newThreshold;
        emit ThresholdUpdated(old, newThreshold);
    }

    // ── View functions ──────────────────────────────────────────────

    function oracleMembers() external view returns (address[] memory) {
        return _oracleMembers;
    }

    function oracleCount() external view returns (uint256) {
        return _oracleMembers.length;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
