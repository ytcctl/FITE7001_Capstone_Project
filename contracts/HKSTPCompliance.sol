// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title HKSTPCompliance
 * @notice Modular compliance contract following the
 *         "Policy off-chain, enforcement on-chain" pattern.
 *
 * Each transfer requires a one-time signed attestation from the Compliance
 * Oracle, binding the approval to (from, to, amount, expiry, nonce).
 * Once consumed, the attestation cannot be reused (replay protection).
 *
 * Additional modules (enforced by the token's _beforeTokenTransfer hook):
 *   - Concentration cap per investor
 *   - Jurisdiction whitelist / blacklist
 *   - Lock-up period enforcement
 *   - Conditional transfer (attestation required)
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE  — platform admin; sets oracle and module parameters
 *   TOKEN_ROLE          — allowed to call canTransfer() and consumeAttestation()
 */
contract HKSTPCompliance is AccessControl, EIP712 {
    using ECDSA for bytes32;

    bytes32 public constant TOKEN_ROLE = keccak256("TOKEN_ROLE");

    // EIP-712 type hash for the off-chain attestation struct
    bytes32 public constant ATTESTATION_TYPEHASH =
        keccak256(
            "Attestation(address from,address to,uint256 amount,uint256 expiry,uint256 nonce)"
        );

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// @notice Address of the Compliance Oracle (signs per-transfer attestations).
    address public complianceOracle;

    /// @dev Tracks consumed attestation hashes (replay protection).
    mapping(bytes32 => bool) public usedAttestations;

    /// @dev Per-token, per-investor concentration cap: token => investor => cap.  0 = no cap.
    mapping(address => mapping(address => uint256)) public concentrationCap;

    /// @dev Per-token global concentration cap: token => cap.  0 = no cap.
    mapping(address => uint256) public globalConcentrationCap;

    /// @dev Approved jurisdiction codes (ISO-3166 two-letter, e.g. "HK").
    mapping(bytes2 => bool) public allowedJurisdictions;

    /// @dev Per-token lock-up end timestamps: investor => lockUpEnd (Unix).
    mapping(address => uint256) public lockUpEnd;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event OracleUpdated(address indexed previous, address indexed current);
    event AttestationConsumed(bytes32 indexed hash, address indexed from, address indexed to);
    event ConcentrationCapSet(address indexed token, address indexed investor, uint256 cap);
    event GlobalConcentrationCapSet(address indexed token, uint256 cap);
    event JurisdictionSet(bytes2 indexed jurisdiction, bool allowed);
    event LockUpSet(address indexed investor, uint256 lockUpEnd);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    constructor(address admin, address oracle)
        EIP712("HKSTPCompliance", "1")
    {
        require(oracle != address(0), "HKSTPCompliance: zero oracle");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        complianceOracle = oracle;
        emit OracleUpdated(address(0), oracle);

        // HK is approved by default
        allowedJurisdictions[bytes2("HK")] = true;

        // XX is the neutral country code used by safe-listed operational
        // addresses (OrderBook escrow, custody, etc.) so they pass
        // jurisdiction checks when one side of a transfer is safe-listed.
        allowedJurisdictions[bytes2("XX")] = true;
    }

    // -------------------------------------------------------------------------
    // Oracle management
    // -------------------------------------------------------------------------

    /**
     * @notice Update the Compliance Oracle signing key.
     * @param oracle New oracle address.
     */
    function setComplianceOracle(address oracle) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(oracle != address(0), "HKSTPCompliance: zero oracle");
        emit OracleUpdated(complianceOracle, oracle);
        complianceOracle = oracle;
    }

    // -------------------------------------------------------------------------
    // Module configuration
    // -------------------------------------------------------------------------

    /**
     * @notice Set a per-investor concentration cap (max holdings) for a specific token.
     * @param token    Token contract address.
     * @param investor Target investor.
     * @param cap      Maximum token balance allowed (0 = no individual cap).
     */
    function setConcentrationCap(address token, address investor, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        concentrationCap[token][investor] = cap;
        emit ConcentrationCapSet(token, investor, cap);
    }

    /**
     * @notice Set the global concentration cap for a specific token.
     * @param token Token contract address.
     * @param cap   Global maximum token balance (0 = disabled).
     */
    function setGlobalConcentrationCap(address token, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        globalConcentrationCap[token] = cap;
        emit GlobalConcentrationCapSet(token, cap);
    }

    /**
     * @notice Allow or disallow transfers to/from a specific jurisdiction.
     * @param jurisdiction ISO-3166 two-letter country code encoded as bytes2.
     * @param allowed      true = allowed, false = blocked.
     */
    function setJurisdiction(bytes2 jurisdiction, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        allowedJurisdictions[jurisdiction] = allowed;
        emit JurisdictionSet(jurisdiction, allowed);
    }

    /**
     * @notice Set a lock-up end timestamp for an investor.
     * @param investor Investor wallet.
     * @param endTime  Unix timestamp after which the investor may transfer.
     */
    function setLockUp(address investor, uint256 endTime) external onlyRole(DEFAULT_ADMIN_ROLE) {
        lockUpEnd[investor] = endTime;
        emit LockUpSet(investor, endTime);
    }

    // -------------------------------------------------------------------------
    // Core compliance check
    // -------------------------------------------------------------------------

    /**
     * @notice Verify a one-time attestation from the Compliance Oracle.
     *         Does NOT consume (mark used) the attestation — use consumeAttestation for that.
     * @param from    Sender wallet.
     * @param to      Recipient wallet.
     * @param amount  Token amount.
     * @param expiry  Unix timestamp; attestation is invalid after this time.
     * @param nonce   Unique value to prevent replay across different trades.
     * @param sig     EIP-712 signature by the Compliance Oracle.
     * @return true if the attestation is valid and not yet consumed.
     */
    function verifyAttestation(
        address from,
        address to,
        uint256 amount,
        uint256 expiry,
        uint256 nonce,
        bytes calldata sig
    ) public view returns (bool) {
        if (block.timestamp > expiry) return false;

        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, from, to, amount, expiry, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        bytes32 attestHash = keccak256(abi.encode(from, to, amount, expiry, nonce));

        if (usedAttestations[attestHash]) return false;
        return digest.recover(sig) == complianceOracle;
    }

    /**
     * @notice Verify AND consume an attestation in one call (used by the token contract).
     *         Only callable by addresses with TOKEN_ROLE.
     * @return true if valid; reverts if invalid.
     */
    function consumeAttestation(
        address from,
        address to,
        uint256 amount,
        uint256 expiry,
        uint256 nonce,
        bytes calldata sig
    ) external onlyRole(TOKEN_ROLE) returns (bool) {
        require(block.timestamp <= expiry, "HKSTPCompliance: attestation expired");

        bytes32 structHash = keccak256(
            abi.encode(ATTESTATION_TYPEHASH, from, to, amount, expiry, nonce)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        bytes32 attestHash = keccak256(abi.encode(from, to, amount, expiry, nonce));

        require(!usedAttestations[attestHash], "HKSTPCompliance: attestation already used");
        require(digest.recover(sig) == complianceOracle, "HKSTPCompliance: invalid signer");

        usedAttestations[attestHash] = true;
        emit AttestationConsumed(attestHash, from, to);
        return true;
    }

    /**
     * @notice Check all non-attestation module rules for a transfer.
     *         Called by the token contract's transfer hook (safe-listed transfers
     *         or when compliance oracle rules allow skipping attestation).
     * @param from         Sender.
     * @param to           Recipient.
     * @param amount       Transfer amount.
     * @param toBalance    Recipient's balance AFTER the transfer would occur.
     * @param fromCountry  Sender's ISO-3166 country code (bytes2).
     * @param toCountry    Recipient's ISO-3166 country code (bytes2).
     * @return ok    true if all modules pass.
     * @return reason Human-readable rejection reason (empty string on success).
     */
    function checkModules(
        address from,
        address to,
        uint256 amount,
        uint256 toBalance,
        bytes2  fromCountry,
        bytes2  toCountry
    ) external view returns (bool ok, string memory reason) {
        // Lock-up check
        if (lockUpEnd[from] != 0 && block.timestamp < lockUpEnd[from]) {
            return (false, "HKSTPCompliance: sender locked up");
        }

        // Jurisdiction checks
        if (fromCountry != bytes2(0) && !allowedJurisdictions[fromCountry]) {
            return (false, "HKSTPCompliance: sender jurisdiction blocked");
        }
        if (toCountry != bytes2(0) && !allowedJurisdictions[toCountry]) {
            return (false, "HKSTPCompliance: recipient jurisdiction blocked");
        }

        // Global concentration cap (keyed by calling token = msg.sender)
        uint256 gCap = globalConcentrationCap[msg.sender];
        if (gCap != 0 && toBalance > gCap) {
            return (false, "HKSTPCompliance: global concentration cap exceeded");
        }

        // Per-investor concentration cap (keyed by calling token = msg.sender)
        uint256 cap = concentrationCap[msg.sender][to];
        if (cap != 0 && toBalance > cap) {
            return (false, "HKSTPCompliance: investor concentration cap exceeded");
        }

        // Silence unused-variable warning for `amount` — it is passed for
        // future module extensibility (e.g., daily transfer limits).
        amount;

        return (true, "");
    }

    // -------------------------------------------------------------------------
    // EIP-712 domain separator (public, for off-chain signers)
    // -------------------------------------------------------------------------

    /// @notice Returns the EIP-712 domain separator hash.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
