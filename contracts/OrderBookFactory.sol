// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./OrderBook.sol";

/**
 * @title OrderBookFactory
 * @notice Deploys and registers one OrderBook per security-token / cash-token pair.
 *
 * TokenHub lists multiple security tokens via TokenFactory.  Each listed token
 * needs its own order book to trade against the shared cash token (tokenized HKD).
 * This factory:
 *   1. Deploys a new OrderBook(securityToken, cashToken, …) for each market.
 *   2. Stores the mapping: securityToken address → OrderBook address.
 *   3. Exposes view functions so the frontend can discover all markets.
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — can create new order books and pause/unpause.
 */
contract OrderBookFactory is AccessControl {

    // -------------------------------------------------------------------------
    // Data structures
    // -------------------------------------------------------------------------

    struct Market {
        address securityToken;   // The security token traded
        address orderBook;       // Deployed OrderBook contract
        string  name;            // Human-readable market name (e.g. "HKSTP / HKD")
        string  symbol;          // Token symbol (e.g. "HKSTP")
        uint256 createdAt;
        bool    active;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    /// Shared cash token used as the quote currency for all markets
    address public immutable cashToken;
    uint8   public immutable cashDecimals;

    /// Identity Registry used for KYC verification in each OrderBook
    address public immutable identityRegistry;

    /// Market registry
    Market[] private _markets;

    /// securityToken address → market index (1-based; 0 = not found)
    mapping(address => uint256) private _marketIndex;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event MarketCreated(
        uint256 indexed index,
        address indexed securityToken,
        address indexed orderBook,
        string  name,
        string  symbol
    );
    event MarketDeactivated(uint256 indexed index, address securityToken);
    event MarketReactivated(uint256 indexed index, address securityToken);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param _cashToken        The shared cash token (tokenized HKD).
     * @param _cashDecimals     Decimals of the cash token (usually 6).
     * @param _identityRegistry HKSTPIdentityRegistry — passed to each OrderBook for KYC.
     * @param admin             Admin address.
     */
    constructor(address _cashToken, uint8 _cashDecimals, address _identityRegistry, address admin) {
        require(_cashToken        != address(0), "OBFactory: zero cashToken");
        require(_identityRegistry != address(0), "OBFactory: zero identityRegistry");
        require(admin             != address(0), "OBFactory: zero admin");

        cashToken        = _cashToken;
        cashDecimals     = _cashDecimals;
        identityRegistry = _identityRegistry;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // Create market
    // -------------------------------------------------------------------------

    /**
     * @notice Deploy a new OrderBook for a security token.
     * @param _securityToken Address of the security token.
     * @param _secDecimals   Decimals of the security token (usually 18).
     * @param _name          Human-readable market name (e.g. "HKSTP / HKD").
     * @param _symbol        Token symbol (e.g. "HKSTP").
     * @return orderBook     Address of the newly deployed OrderBook.
     */
    function createOrderBook(
        address _securityToken,
        uint8   _secDecimals,
        string calldata _name,
        string calldata _symbol
    )
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        returns (address orderBook)
    {
        require(_securityToken != address(0), "OBFactory: zero securityToken");
        require(_marketIndex[_securityToken] == 0, "OBFactory: market exists");

        // Deploy a new OrderBook
        OrderBook ob = new OrderBook(
            _securityToken,
            cashToken,
            _secDecimals,
            cashDecimals,
            identityRegistry,
            msg.sender      // admin of the new OrderBook
        );
        orderBook = address(ob);

        _markets.push(Market({
            securityToken: _securityToken,
            orderBook:     orderBook,
            name:          _name,
            symbol:        _symbol,
            createdAt:     block.timestamp,
            active:        true
        }));
        _marketIndex[_securityToken] = _markets.length; // 1-based

        emit MarketCreated(_markets.length - 1, _securityToken, orderBook, _name, _symbol);
    }

    // -------------------------------------------------------------------------
    // Deactivate / Reactivate
    // -------------------------------------------------------------------------

    function deactivateMarket(uint256 index) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(index < _markets.length, "OBFactory: invalid index");
        _markets[index].active = false;
        emit MarketDeactivated(index, _markets[index].securityToken);
    }

    function reactivateMarket(uint256 index) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(index < _markets.length, "OBFactory: invalid index");
        _markets[index].active = true;
        emit MarketReactivated(index, _markets[index].securityToken);
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /**
     * @notice Get the OrderBook address for a given security token.
     * @return The OrderBook contract address (address(0) if none).
     */
    function getOrderBook(address _securityToken) external view returns (address) {
        uint256 idx = _marketIndex[_securityToken];
        if (idx == 0) return address(0);
        return _markets[idx - 1].orderBook;
    }

    /**
     * @notice Get full Market struct by index.
     */
    function getMarket(uint256 index) external view returns (Market memory) {
        require(index < _markets.length, "OBFactory: invalid index");
        return _markets[index];
    }

    /**
     * @notice Get all markets.
     */
    function allMarkets() external view returns (Market[] memory) {
        return _markets;
    }

    /**
     * @notice Get only active markets.
     */
    function activeMarkets() external view returns (Market[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < _markets.length; i++) {
            if (_markets[i].active) count++;
        }
        Market[] memory result = new Market[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < _markets.length; i++) {
            if (_markets[i].active) {
                result[j++] = _markets[i];
            }
        }
        return result;
    }

    /**
     * @notice Total number of markets (active + inactive).
     */
    function marketCount() external view returns (uint256) {
        return _markets.length;
    }
}
