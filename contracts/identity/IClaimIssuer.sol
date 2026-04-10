// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IClaimIssuer
 * @notice Interface for Trusted Claim Issuer contracts.
 *         A Claim Issuer can sign claims off-chain and optionally revoke them.
 */
interface IClaimIssuer {
    /// @notice Returns true if the claim identified by `claimId` has been revoked.
    function isClaimRevoked(bytes32 claimId) external view returns (bool);

    /// @notice Returns true if the given signature is valid for the claim data.
    function isClaimValid(
        address identityContract,
        uint256 topic,
        bytes calldata sig,
        bytes calldata data
    ) external view returns (bool);
}
