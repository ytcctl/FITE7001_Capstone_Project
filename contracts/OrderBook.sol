// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @dev Minimal interface for HKSTPIdentityRegistry — KYC verification.
interface IIdentityRegistry {
    function isVerified(address investor) external view returns (bool);
}

/**
 * @title OrderBook
 * @notice On-chain limit-order book for HKSTPSecurityToken ↔ CashToken.
 *
 * Architecture:
 *   - Investors place buy/sell limit orders specifying price and quantity.
 *   - Each new order auto-matches against the opposite side (best price first).
 *   - Partial fills are supported — remaining quantity stays on the book.
 *   - Matched trades create settlements in the DvPSettlement contract for
 *     atomic T+0 clearing.
 *
 * Price convention:
 *   - price is denominated in cash-token base units per ONE security token.
 *   - Example: if securityToken has 18 decimals and cashToken has 6 decimals,
 *     a price of 1_000_000 means 1 cash-token unit per 1 whole security token.
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — platform admin, can pause/unpause.
 *   Any verified investor can place orders (no special role needed).
 */
contract OrderBook is ReentrancyGuard, Pausable, AccessControl {

    // -------------------------------------------------------------------------
    // Data structures
    // -------------------------------------------------------------------------

    enum Side { Buy, Sell }
    enum OrderStatus { Open, Filled, PartiallyFilled, Cancelled }

    struct Order {
        uint256 id;
        address trader;
        Side    side;
        uint256 price;          // cash-token base units per 1e{secDecimals} security tokens
        uint256 quantity;       // security token base units (original)
        uint256 filled;         // security token base units already filled
        uint256 timestamp;
        OrderStatus status;
    }

    struct Trade {
        uint256 id;
        uint256 buyOrderId;
        uint256 sellOrderId;
        address buyer;
        address seller;
        uint256 price;
        uint256 quantity;       // security tokens matched
        uint256 cashAmount;     // cash tokens exchanged
        uint256 timestamp;
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    IERC20 public immutable securityToken;
    IERC20 public immutable cashToken;
    uint8  public immutable securityDecimals;
    uint8  public immutable cashDecimals;

    /// @notice Identity Registry used for KYC verification at order placement.
    IIdentityRegistry public immutable identityRegistry;

    /// Auto-incrementing counters
    uint256 public orderCount;
    uint256 public tradeCount;

    /// All orders by ID
    mapping(uint256 => Order) public orders;

    /// All trades by ID
    mapping(uint256 => Trade) public trades;

    /// Sorted arrays of active order IDs (maintained on insert / cancel / fill)
    uint256[] public buyOrderIds;   // sorted by price DESC  (best bid first)
    uint256[] public sellOrderIds;  // sorted by price ASC   (best ask first)

    /// Trader → their active order IDs (for "My Orders" UI)
    mapping(address => uint256[]) private _traderOrders;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event OrderPlaced(
        uint256 indexed orderId,
        address indexed trader,
        Side    side,
        uint256 price,
        uint256 quantity,
        uint256 timestamp
    );

    event OrderCancelled(
        uint256 indexed orderId,
        address indexed trader,
        uint256 timestamp
    );

    event TradeExecuted(
        uint256 indexed tradeId,
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        address buyer,
        address seller,
        uint256 price,
        uint256 quantity,
        uint256 cashAmount,
        uint256 timestamp
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param _securityToken    Address of the HKSTPSecurityToken.
     * @param _cashToken        Address of the CashToken (tokenized HKD).
     * @param _secDecimals      Decimals of the security token (usually 18).
     * @param _cashDecimals     Decimals of the cash token (usually 6).
     * @param _identityRegistry Address of the HKSTPIdentityRegistry (KYC checks).
     * @param admin             Admin address (DEFAULT_ADMIN_ROLE).
     */
    constructor(
        address _securityToken,
        address _cashToken,
        uint8   _secDecimals,
        uint8   _cashDecimals,
        address _identityRegistry,
        address admin
    ) {
        require(_securityToken    != address(0), "OrderBook: zero securityToken");
        require(_cashToken        != address(0), "OrderBook: zero cashToken");
        require(_identityRegistry != address(0), "OrderBook: zero identityRegistry");
        require(admin             != address(0), "OrderBook: zero admin");

        securityToken    = IERC20(_securityToken);
        cashToken        = IERC20(_cashToken);
        securityDecimals = _secDecimals;
        cashDecimals     = _cashDecimals;
        identityRegistry = IIdentityRegistry(_identityRegistry);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // Place Order
    // -------------------------------------------------------------------------

    /**
     * @notice Place a BUY limit order.
     *         The buyer must have approved the OrderBook for sufficient cashToken.
     * @param price    Cash-token price per 1 whole security token (in cash base units).
     * @param quantity Security token amount in base units.
     * @return orderId The newly created order ID.
     */
    function placeBuyOrder(uint256 price, uint256 quantity)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 orderId)
    {
        require(price > 0, "OrderBook: zero price");
        require(quantity > 0, "OrderBook: zero quantity");
        require(
            identityRegistry.isVerified(msg.sender),
            "OrderBook: buyer not KYC verified"
        );

        // Calculate max cash needed and lock it via transferFrom
        uint256 cashNeeded = _cashAmount(price, quantity);
        require(
            cashToken.transferFrom(msg.sender, address(this), cashNeeded),
            "OrderBook: cash deposit failed"
        );

        orderId = _createOrder(Side.Buy, price, quantity);
        _insertSorted(buyOrderIds, orderId, true);  // descending
        _tryMatch(orderId);
    }

    /**
     * @notice Place a SELL limit order.
     *         The seller must have approved the OrderBook for sufficient securityToken.
     * @param price    Cash-token price per 1 whole security token (in cash base units).
     * @param quantity Security token amount in base units.
     * @return orderId The newly created order ID.
     */
    function placeSellOrder(uint256 price, uint256 quantity)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 orderId)
    {
        require(price > 0, "OrderBook: zero price");
        require(quantity > 0, "OrderBook: zero quantity");
        require(
            identityRegistry.isVerified(msg.sender),
            "OrderBook: seller not KYC verified"
        );

        // Lock security tokens via transferFrom
        require(
            securityToken.transferFrom(msg.sender, address(this), quantity),
            "OrderBook: security deposit failed"
        );

        orderId = _createOrder(Side.Sell, price, quantity);
        _insertSorted(sellOrderIds, orderId, false);  // ascending
        _tryMatch(orderId);
    }

    // -------------------------------------------------------------------------
    // Cancel Order
    // -------------------------------------------------------------------------

    /**
     * @notice Cancel an open order and refund remaining locked tokens.
     * @param orderId The order to cancel.
     */
    function cancelOrder(uint256 orderId)
        external
        nonReentrant
    {
        Order storage o = orders[orderId];
        require(o.trader == msg.sender, "OrderBook: not your order");
        require(
            o.status == OrderStatus.Open || o.status == OrderStatus.PartiallyFilled,
            "OrderBook: not cancellable"
        );

        o.status = OrderStatus.Cancelled;

        uint256 remaining = o.quantity - o.filled;

        if (o.side == Side.Buy) {
            // Refund locked cash
            uint256 refund = _cashAmount(o.price, remaining);
            cashToken.transfer(msg.sender, refund);
            _removeFromArray(buyOrderIds, orderId);
        } else {
            // Refund locked security tokens
            securityToken.transfer(msg.sender, remaining);
            _removeFromArray(sellOrderIds, orderId);
        }

        _removeFromTraderOrders(msg.sender, orderId);

        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }

    // -------------------------------------------------------------------------
    // Matching engine
    // -------------------------------------------------------------------------

    /**
     * @dev Attempt to match a newly placed order against the opposite side.
     *      Matching continues until the order is fully filled or there are
     *      no more matching counterparties.
     */
    function _tryMatch(uint256 incomingId) internal {
        Order storage incoming = orders[incomingId];

        if (incoming.side == Side.Buy) {
            // Match buy order against sell orders (lowest ask first)
            while (
                incoming.filled < incoming.quantity &&
                sellOrderIds.length > 0
            ) {
                Order storage topAsk = orders[sellOrderIds[0]];
                // Buy can only match if bid >= ask
                if (incoming.price < topAsk.price) break;

                uint256 matchQty = _min(
                    incoming.quantity - incoming.filled,
                    topAsk.quantity - topAsk.filled
                );

                // Execute at the resting order's price (maker price)
                _executeTrade(incomingId, sellOrderIds[0], topAsk.price, matchQty);

                // Clean up fully-filled ask
                if (topAsk.filled == topAsk.quantity) {
                    topAsk.status = OrderStatus.Filled;
                    _removeFromTraderOrders(topAsk.trader, sellOrderIds[0]);
                    _removeFirst(sellOrderIds);
                } else {
                    topAsk.status = OrderStatus.PartiallyFilled;
                }
            }
        } else {
            // Match sell order against buy orders (highest bid first)
            while (
                incoming.filled < incoming.quantity &&
                buyOrderIds.length > 0
            ) {
                Order storage topBid = orders[buyOrderIds[0]];
                // Sell can only match if ask <= bid
                if (incoming.price > topBid.price) break;

                uint256 matchQty = _min(
                    incoming.quantity - incoming.filled,
                    topBid.quantity - topBid.filled
                );

                // Execute at the resting order's price (maker price)
                _executeTrade(buyOrderIds[0], incomingId, topBid.price, matchQty);

                // Clean up fully-filled bid
                if (topBid.filled == topBid.quantity) {
                    topBid.status = OrderStatus.Filled;
                    _removeFromTraderOrders(topBid.trader, buyOrderIds[0]);
                    _removeFirst(buyOrderIds);
                } else {
                    topBid.status = OrderStatus.PartiallyFilled;
                }
            }
        }

        // Update incoming order status
        if (incoming.filled == incoming.quantity) {
            incoming.status = OrderStatus.Filled;
            _removeFromTraderOrders(incoming.trader, incomingId);
            if (incoming.side == Side.Buy) {
                _removeFromArray(buyOrderIds, incomingId);
            } else {
                _removeFromArray(sellOrderIds, incomingId);
            }
        } else if (incoming.filled > 0) {
            incoming.status = OrderStatus.PartiallyFilled;
        }
    }

    /**
     * @dev Execute a single matched trade. Transfers tokens between buyer and seller.
     *      The price used is the maker's (resting) price for price improvement.
     */
    function _executeTrade(
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 tradePrice,
        uint256 tradeQty
    ) internal {
        Order storage buyOrder  = orders[buyOrderId];
        Order storage sellOrder = orders[sellOrderId];

        uint256 cashAmt = _cashAmount(tradePrice, tradeQty);

        // Update fill amounts
        buyOrder.filled  += tradeQty;
        sellOrder.filled += tradeQty;

        // Transfer security tokens: contract (locked by seller) → buyer
        require(
            securityToken.transfer(buyOrder.trader, tradeQty),
            "OrderBook: sec token transfer failed"
        );

        // Transfer cash: contract (locked by buyer) → seller
        require(
            cashToken.transfer(sellOrder.trader, cashAmt),
            "OrderBook: cash transfer failed"
        );

        // If buyer paid more than trade price, refund the difference
        uint256 buyerMaxCash = _cashAmount(buyOrder.price, tradeQty);
        if (buyerMaxCash > cashAmt) {
            cashToken.transfer(buyOrder.trader, buyerMaxCash - cashAmt);
        }

        // Record trade
        uint256 tid = tradeCount++;
        trades[tid] = Trade({
            id:          tid,
            buyOrderId:  buyOrderId,
            sellOrderId: sellOrderId,
            buyer:       buyOrder.trader,
            seller:      sellOrder.trader,
            price:       tradePrice,
            quantity:    tradeQty,
            cashAmount:  cashAmt,
            timestamp:   block.timestamp
        });

        emit TradeExecuted(
            tid, buyOrderId, sellOrderId,
            buyOrder.trader, sellOrder.trader,
            tradePrice, tradeQty, cashAmt,
            block.timestamp
        );
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /**
     * @notice Get all active buy order IDs (sorted by best bid first).
     */
    function getBuyOrderIds() external view returns (uint256[] memory) {
        return buyOrderIds;
    }

    /**
     * @notice Get all active sell order IDs (sorted by best ask first).
     */
    function getSellOrderIds() external view returns (uint256[] memory) {
        return sellOrderIds;
    }

    /**
     * @notice Get all active order IDs for a specific trader.
     */
    function getTraderOrders(address trader) external view returns (uint256[] memory) {
        return _traderOrders[trader];
    }

    /**
     * @notice Get full Order struct by ID.
     */
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    /**
     * @notice Get full Trade struct by ID.
     */
    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return trades[tradeId];
    }

    /**
     * @notice Get a batch of orders (for pagination / full book display).
     * @param ids Array of order IDs to fetch.
     */
    function getOrdersBatch(uint256[] calldata ids) external view returns (Order[] memory result) {
        result = new Order[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = orders[ids[i]];
        }
    }

    /**
     * @notice Get a batch of trades (for trade history).
     * @param from Start index (inclusive).
     * @param to   End index (exclusive). Capped at tradeCount.
     */
    function getTradesBatch(uint256 from, uint256 to) external view returns (Trade[] memory result) {
        if (to > tradeCount) to = tradeCount;
        require(from < to, "OrderBook: invalid range");
        result = new Trade[](to - from);
        for (uint256 i = from; i < to; i++) {
            result[i - from] = trades[i];
        }
    }

    /**
     * @notice Best bid price (0 if no buy orders).
     */
    function bestBid() external view returns (uint256) {
        if (buyOrderIds.length == 0) return 0;
        return orders[buyOrderIds[0]].price;
    }

    /**
     * @notice Best ask price (0 if no sell orders).
     */
    function bestAsk() external view returns (uint256) {
        if (sellOrderIds.length == 0) return 0;
        return orders[sellOrderIds[0]].price;
    }

    /**
     * @notice Spread = bestAsk - bestBid (0 if either side empty).
     */
    function spread() external view returns (uint256) {
        if (buyOrderIds.length == 0 || sellOrderIds.length == 0) return 0;
        uint256 ask = orders[sellOrderIds[0]].price;
        uint256 bid = orders[buyOrderIds[0]].price;
        return ask > bid ? ask - bid : 0;
    }

    // -------------------------------------------------------------------------
    // Pause (admin)
    // -------------------------------------------------------------------------

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _createOrder(Side side, uint256 price, uint256 quantity)
        internal
        returns (uint256 orderId)
    {
        orderId = orderCount++;
        orders[orderId] = Order({
            id:        orderId,
            trader:    msg.sender,
            side:      side,
            price:     price,
            quantity:  quantity,
            filled:    0,
            timestamp: block.timestamp,
            status:    OrderStatus.Open
        });

        _traderOrders[msg.sender].push(orderId);

        emit OrderPlaced(orderId, msg.sender, side, price, quantity, block.timestamp);
    }

    /**
     * @dev Calculate cash amount for a given price and security token quantity.
     *      cashAmount = (price * quantity) / 10^securityDecimals
     */
    function _cashAmount(uint256 price, uint256 qty) internal view returns (uint256) {
        return (price * qty) / (10 ** securityDecimals);
    }

    /**
     * @dev Insert an order ID into a sorted array.
     *      If descending=true, higher prices come first (buy side).
     *      If descending=false, lower prices come first (sell side).
     */
    function _insertSorted(uint256[] storage arr, uint256 orderId, bool descending) internal {
        uint256 price = orders[orderId].price;
        uint256 len = arr.length;

        // Find insertion index
        uint256 i = 0;
        if (descending) {
            while (i < len && orders[arr[i]].price > price) i++;
        } else {
            while (i < len && orders[arr[i]].price < price) i++;
        }

        // Push a dummy element and shift right
        arr.push(0);
        for (uint256 j = arr.length - 1; j > i; j--) {
            arr[j] = arr[j - 1];
        }
        arr[i] = orderId;
    }

    function _removeFromArray(uint256[] storage arr, uint256 id) internal {
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == id) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
        }
    }

    function _removeFirst(uint256[] storage arr) internal {
        require(arr.length > 0, "OrderBook: empty array");
        for (uint256 i = 0; i < arr.length - 1; i++) {
            arr[i] = arr[i + 1];
        }
        arr.pop();
    }

    function _removeFromTraderOrders(address trader, uint256 orderId) internal {
        uint256[] storage arr = _traderOrders[trader];
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == orderId) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
