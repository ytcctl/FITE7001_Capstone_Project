// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockCashToken
 * @notice Simple ERC-20 mock representing tokenized HKD.
 *
 * Used in test scenarios to simulate the cash leg of a DvP settlement
 * (Project Ensemble / FPS-backed stablecoin equivalent).
 *
 * The owner may freely mint tokens to any address, making it suitable for
 * unit tests where arbitrary balances need to be set up quickly.
 */
contract MockCashToken is ERC20, Ownable {
    /// @notice Number of decimal places.  Matches USDC/HKD convention (6 decimals).
    uint8 private _decimals;

    /**
     * @param name_     Token name, e.g. "Tokenized HKD".
     * @param symbol_   Token symbol, e.g. "THKD".
     * @param decimals_ Decimal precision (6 for HKD stablecoin convention).
     * @param owner_    Initial owner who can mint.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8  decimals_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        _decimals = decimals_;
    }

    /// @inheritdoc ERC20
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /**
     * @notice Mint tokens to any address.  Only callable by the owner.
     * @param to     Recipient address.
     * @param amount Amount to mint (in smallest unit).
     */
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /**
     * @notice Burn tokens from any address.  Only callable by the owner.
     * @param from   Address to burn from.
     * @param amount Amount to burn.
     */
    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }
}
