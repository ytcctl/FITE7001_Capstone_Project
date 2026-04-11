// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Identity.sol";

/**
 * @title IdentityFactory
 * @notice Deploys per-investor Identity (ONCHAINID) contracts using
 *         EIP-1167 Minimal Proxy (Clone) pattern for gas-efficient deployment.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  EIP-1167 Minimal Proxy Pattern                                 │
 * │  One implementation deployed at construction time.              │
 * │  Each clone costs ~45 bytes on-chain + a delegatecall stub.     │
 * │  Gas savings: ~90 % per identity deployment.                    │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Each deployed Identity clone:
 *   - Is owned by the investor's wallet (MANAGEMENT key)
 *   - Has the platform agent added as a CLAIM key so the agent can add
 *     signed claims without needing the investor's signature
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — can add/remove deployer addresses
 *   DEPLOYER_ROLE      — the IdentityRegistry (allowed to call deployIdentity)
 */
contract IdentityFactory is AccessControl {
    using Clones for address;

    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

    /// @notice Address of the Identity implementation contract (EIP-1167 master copy).
    address public immutable identityImplementation;

    /// @dev investor wallet => deployed Identity clone address
    mapping(address => address) public deployedIdentity;

    /// @notice Total number of identities deployed.
    uint256 public identityCount;

    event IdentityDeployed(
        address indexed investor,
        address indexed identityContract,
        uint256 indexed index
    );

    constructor(address admin) {
        require(admin != address(0), "IdentityFactory: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        // Deploy the implementation contract (constructor arg = address(0)
        // means it stays uninitialised — clones will call initialize())
        identityImplementation = address(new Identity(address(0)));
    }

    /**
     * @notice Deploy a new Identity clone for an investor.
     * @param investor     The investor's wallet address (becomes MANAGEMENT key).
     * @param claimAgent   The platform agent address (added as CLAIM key so they
     *                     can add claims on the investor's Identity contract).
     * @return identityAddr The address of the newly deployed Identity clone.
     */
    function deployIdentity(
        address investor,
        address claimAgent
    ) external onlyRole(DEPLOYER_ROLE) returns (address identityAddr) {
        require(investor != address(0), "IdentityFactory: zero investor");
        require(
            deployedIdentity[investor] == address(0),
            "IdentityFactory: already deployed"
        );

        // ── Clone + initialize with factory as initial management key ──
        identityAddr = identityImplementation.clone();
        Identity id = Identity(identityAddr);
        id.initialize(address(this));

        // Add the investor as a MANAGEMENT key
        bytes32 investorKey = id.addressToKey(investor);
        id.addKey(investorKey, 1, 1); // purpose=MANAGEMENT, keyType=ECDSA

        // Add the claim agent as a CLAIM key (purpose 3)
        if (claimAgent != address(0) && claimAgent != investor) {
            bytes32 agentKey = id.addressToKey(claimAgent);
            id.addKey(agentKey, 3, 1); // purpose=CLAIM, keyType=ECDSA
        }

        // Add the caller (typically the IdentityRegistry) as a CLAIM key
        if (msg.sender != address(this) && msg.sender != investor) {
            bytes32 callerKey = id.addressToKey(msg.sender);
            if (!id.keyHasPurpose(callerKey, 3)) {
                id.addKey(callerKey, 3, 1); // purpose=CLAIM, keyType=ECDSA
            }
        }

        // Remove the factory's own management key — full ownership to investor
        bytes32 factoryKey = id.addressToKey(address(this));
        id.removeKey(factoryKey, 1); // remove MANAGEMENT purpose from factory

        deployedIdentity[investor] = identityAddr;
        identityCount++;

        emit IdentityDeployed(investor, identityAddr, identityCount);
    }

    /**
     * @notice Look up the Identity contract for a given investor.
     * @param investor Investor's wallet address.
     * @return The Identity clone address (or address(0) if not deployed).
     */
    function getIdentity(address investor) external view returns (address) {
        return deployedIdentity[investor];
    }
}
