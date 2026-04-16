// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IIdentity.sol";

/**
 * @title Identity
 * @notice Per-investor ONCHAINID contract implementing ERC-734 (Key Management)
 *         and ERC-735 (Claim Holder).
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  EIP-1167 Minimal Proxy Compatible                              │
 * │  Uses initialize() instead of constructor for clone deployment  │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Architecture:
 *   - Each investor wallet gets its own Identity contract deployed via
 *     IdentityFactory using EIP-1167 Minimal Proxy (Clones).
 *   - The investor's wallet address is the initial MANAGEMENT key (purpose 1).
 *   - The platform admin / KYC agent can be added as a CLAIM key (purpose 3)
 *     so they can add claims on behalf of the investor.
 *   - Claims contain only cryptographic attestations — NO PII on-chain.
 *   - Claim data is: abi.encode(identityAddress, topic, expiryTimestamp)
 *   - Claim signature: ECDSA signature by the Claim Issuer over keccak256(data)
 *
 * Key purposes:
 *   1 = MANAGEMENT (add/remove keys, manage identity)
 *   3 = CLAIM      (add/remove claims)
 */
contract Identity is IIdentity {
    // ── ERC-734: Key storage ────────────────────────────────────

    // key (bytes32) => Key struct
    mapping(bytes32 => Key) private _keys;
    // purpose => list of keys with that purpose
    mapping(uint256 => bytes32[]) private _keysByPurpose;

    // ── ERC-735: Claim storage ──────────────────────────────────

    // claimId => Claim struct
    mapping(bytes32 => Claim) private _claims;
    // topic => list of claimIds
    mapping(uint256 => bytes32[]) private _claimsByTopic;

    // ── Constants ───────────────────────────────────────────────

    uint256 public constant PURPOSE_MANAGEMENT = 1;
    uint256 public constant PURPOSE_ACTION     = 2;
    uint256 public constant PURPOSE_CLAIM      = 3;
    uint256 public constant KEY_TYPE_ECDSA     = 1;

    // ── Initializable guard (EIP-1167 compatible) ───────────────

    bool private _initialized;

    // ── Modifiers ───────────────────────────────────────────────

    modifier onlyManagementOrSelf() {
        require(
            msg.sender == address(this) ||
            _keyHasPurpose(_addressToKey(msg.sender), PURPOSE_MANAGEMENT),
            "Identity: sender lacks MANAGEMENT key"
        );
        _;
    }

    modifier onlyClaimKeyOrManagement() {
        bytes32 senderKey = _addressToKey(msg.sender);
        require(
            _keyHasPurpose(senderKey, PURPOSE_MANAGEMENT) ||
            _keyHasPurpose(senderKey, PURPOSE_CLAIM),
            "Identity: sender lacks CLAIM or MANAGEMENT key"
        );
        _;
    }

    // ── Constructor (backward-compatible + EIP-1167 implementation) ─

    /**
     * @dev When used as an EIP-1167 implementation, pass address(0) so the
     *      implementation contract stays uninitialised.  Clones call
     *      initialize() instead.
     *      For direct deployment (backward compat), pass the management key
     *      address and the contract initialises inline.
     */
    constructor(address initialManagementKey) {
        if (initialManagementKey != address(0)) {
            _doInitialize(initialManagementKey);
        }
    }

    // ── Initializer (called on each EIP-1167 clone) ─────────────

    /**
     * @notice Initialize a cloned Identity contract. Can only be called once.
     * @param initialManagementKey The investor's wallet address — becomes the
     *        MANAGEMENT key owner.
     */
    function initialize(address initialManagementKey) external {
        require(!_initialized, "Identity: already initialized");
        require(initialManagementKey != address(0), "Identity: zero key");
        _doInitialize(initialManagementKey);
    }

    function _doInitialize(address initialManagementKey) internal {
        require(!_initialized, "Identity: already initialized");
        _initialized = true;

        bytes32 key = _addressToKey(initialManagementKey);
        uint256[] memory purposes = new uint256[](1);
        purposes[0] = PURPOSE_MANAGEMENT;

        _keys[key] = Key({
            purposes: purposes,
            keyType: KEY_TYPE_ECDSA,
            key: key
        });
        _keysByPurpose[PURPOSE_MANAGEMENT].push(key);

        emit KeyAdded(key, PURPOSE_MANAGEMENT, KEY_TYPE_ECDSA);
    }

    // ── ERC-734: Key Management ─────────────────────────────────

    function getKey(bytes32 key) external view override returns (
        uint256[] memory purposes,
        uint256 keyType,
        bytes32 keyValue
    ) {
        Key storage k = _keys[key];
        return (k.purposes, k.keyType, k.key);
    }

    function keyHasPurpose(bytes32 key, uint256 purpose) external view override returns (bool) {
        return _keyHasPurpose(key, purpose);
    }

    function addKey(
        bytes32 key,
        uint256 purpose,
        uint256 keyType
    ) external override onlyManagementOrSelf {
        require(!_keyHasPurpose(key, purpose), "Identity: key already has purpose");

        if (_keys[key].key == bytes32(0)) {
            // New key
            uint256[] memory purposes = new uint256[](1);
            purposes[0] = purpose;
            _keys[key] = Key({ purposes: purposes, keyType: keyType, key: key });
        } else {
            // Existing key — add purpose
            _keys[key].purposes.push(purpose);
        }
        _keysByPurpose[purpose].push(key);

        emit KeyAdded(key, purpose, keyType);
    }

    function removeKey(
        bytes32 key,
        uint256 purpose
    ) external override onlyManagementOrSelf {
        require(_keyHasPurpose(key, purpose), "Identity: key does not have purpose");

        // Remove purpose from key's purposes array
        uint256[] storage purposes = _keys[key].purposes;
        for (uint256 i = 0; i < purposes.length; i++) {
            if (purposes[i] == purpose) {
                purposes[i] = purposes[purposes.length - 1];
                purposes.pop();
                break;
            }
        }

        // Remove key from _keysByPurpose
        bytes32[] storage purposeKeys = _keysByPurpose[purpose];
        for (uint256 i = 0; i < purposeKeys.length; i++) {
            if (purposeKeys[i] == key) {
                purposeKeys[i] = purposeKeys[purposeKeys.length - 1];
                purposeKeys.pop();
                break;
            }
        }

        // If key has no purposes left, delete it
        if (_keys[key].purposes.length == 0) {
            delete _keys[key];
        }

        emit KeyRemoved(key, purpose, KEY_TYPE_ECDSA);
    }

    // ── ERC-735: Claim Holder ───────────────────────────────────

    /**
     * @notice Add or update a claim. Only callable by addresses with CLAIM or
     *         MANAGEMENT key purpose. The claimId is deterministic:
     *         keccak256(abi.encode(issuer, topic)).
     *
     * @param topic     Claim topic (1=KYC, 2=Accredited, etc.)
     * @param scheme    Signature scheme (1 = ECDSA)
     * @param issuer    Address of the Claim Issuer contract
     * @param signature Issuer's ECDSA signature over keccak256(abi.encode(identity, topic, data))
     * @param data      Opaque claim data (e.g. abi.encode(identity, topic, expiry))
     * @param uri       Off-chain URI for claim details
     */
    function addClaim(
        uint256 topic,
        uint256 scheme,
        address issuer,
        bytes calldata signature,
        bytes calldata data,
        string calldata uri
    ) external override onlyClaimKeyOrManagement returns (bytes32 claimId) {
        claimId = keccak256(abi.encode(issuer, topic));

        bool isUpdate = _claims[claimId].issuer != address(0);

        _claims[claimId] = Claim({
            topic:     topic,
            scheme:    scheme,
            issuer:    issuer,
            signature: signature,
            data:      data,
            uri:       uri
        });

        if (isUpdate) {
            emit ClaimChanged(claimId, topic, issuer);
        } else {
            _claimsByTopic[topic].push(claimId);
            emit ClaimAdded(claimId, topic, issuer);
        }
    }

    /**
     * @notice Remove a claim. Only callable by MANAGEMENT key or the claim issuer.
     */
    function removeClaim(bytes32 claimId) external override {
        Claim storage c = _claims[claimId];
        require(c.issuer != address(0), "Identity: claim does not exist");

        // Only management key or the original issuer can remove
        bytes32 senderKey = _addressToKey(msg.sender);
        require(
            _keyHasPurpose(senderKey, PURPOSE_MANAGEMENT) || msg.sender == c.issuer,
            "Identity: not authorized to remove claim"
        );

        uint256 topic = c.topic;
        address issuer = c.issuer;

        // Remove from _claimsByTopic
        bytes32[] storage topicClaims = _claimsByTopic[topic];
        for (uint256 i = 0; i < topicClaims.length; i++) {
            if (topicClaims[i] == claimId) {
                topicClaims[i] = topicClaims[topicClaims.length - 1];
                topicClaims.pop();
                break;
            }
        }

        delete _claims[claimId];
        emit ClaimRemoved(claimId, topic, issuer);
    }

    function getClaim(bytes32 claimId) external view override returns (
        uint256 topic,
        uint256 scheme,
        address issuer,
        bytes memory signature,
        bytes memory data,
        string memory uri
    ) {
        Claim storage c = _claims[claimId];
        return (c.topic, c.scheme, c.issuer, c.signature, c.data, c.uri);
    }

    function getClaimIdsByTopic(uint256 topic) external view override returns (bytes32[] memory) {
        return _claimsByTopic[topic];
    }

    // ── Internal helpers ────────────────────────────────────────

    function _addressToKey(address addr) internal pure returns (bytes32) {
        return keccak256(abi.encode(addr));
    }

    function _keyHasPurpose(bytes32 key, uint256 purpose) internal view returns (bool) {
        uint256[] storage purposes = _keys[key].purposes;
        for (uint256 i = 0; i < purposes.length; i++) {
            if (purposes[i] == purpose) return true;
        }
        return false;
    }

    /// @notice Utility: convert an address to its key hash (public).
    function addressToKey(address addr) external pure returns (bytes32) {
        return _addressToKey(addr);
    }
}
