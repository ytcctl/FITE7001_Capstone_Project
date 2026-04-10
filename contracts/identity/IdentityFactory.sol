// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./Identity.sol";

/**
 * @title IdentityFactory
 * @notice Deploys per-investor Identity (ONCHAINID) contracts.
 *         Called by the IdentityRegistry when registering a new investor.
 *
 * Each deployed Identity contract:
 *   - Is owned by the investor's wallet (MANAGEMENT key)
 *   - Has the platform agent added as a CLAIM key so the agent can add
 *     signed claims without needing the investor's signature
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — can add/remove deployer addresses
 *   DEPLOYER_ROLE      — the IdentityRegistry (allowed to call deployIdentity)
 */
contract IdentityFactory is AccessControl {
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

    /// @dev investor wallet => deployed Identity contract address
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
    }

    /**
     * @notice Deploy a new Identity contract for an investor.
     * @param investor     The investor's wallet address (becomes MANAGEMENT key).
     * @param claimAgent   The platform agent address (added as CLAIM key so they
     *                     can add claims on the investor's Identity contract).
     * @return identityAddr The address of the newly deployed Identity contract.
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

        // Deploy Identity with FACTORY as initial management key (so we can configure it)
        Identity id = new Identity(address(this));
        identityAddr = address(id);

        // Add the investor as a MANAGEMENT key
        bytes32 investorKey = id.addressToKey(investor);
        id.addKey(investorKey, 1, 1); // purpose=MANAGEMENT, keyType=ECDSA

        // Add the claim agent as a CLAIM key (purpose 3)
        // This allows the platform agent to add signed claims to the identity
        if (claimAgent != address(0) && claimAgent != investor) {
            bytes32 agentKey = id.addressToKey(claimAgent);
            id.addKey(agentKey, 3, 1); // purpose=CLAIM, keyType=ECDSA
        }

        // Add the caller (typically the IdentityRegistry) as a CLAIM key
        // so it can add claims on behalf of agents via issueClaim()
        if (msg.sender != address(this) && msg.sender != investor) {
            bytes32 callerKey = id.addressToKey(msg.sender);
            if (!id.keyHasPurpose(callerKey, 3)) {
                id.addKey(callerKey, 3, 1); // purpose=CLAIM, keyType=ECDSA
            }
        }

        // Remove the factory's own management key — transferring full ownership to investor
        bytes32 factoryKey = id.addressToKey(address(this));
        id.removeKey(factoryKey, 1); // remove MANAGEMENT purpose from factory

        deployedIdentity[investor] = identityAddr;
        identityCount++;

        emit IdentityDeployed(investor, identityAddr, identityCount);
    }

    /**
     * @notice Look up the Identity contract for a given investor.
     * @param investor Investor's wallet address.
     * @return The Identity contract address (or address(0) if not deployed).
     */
    function getIdentity(address investor) external view returns (address) {
        return deployedIdentity[investor];
    }
}
