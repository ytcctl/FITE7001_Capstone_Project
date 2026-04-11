// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title DvPSettlement
 * @notice Atomic Delivery-versus-Payment (DvP) settlement contract.
 *
 * Architecture overview:
 *   - Off-chain: Matching engine matches buy/sell orders and calls createSettlement()
 *   - On-chain:  executeSettlement() atomically moves both legs in a single transaction
 *
 * Both legs (security token + cash token) execute atomically:
 *   Leg 1: Security tokens from seller → buyer  (triggers T-REX compliance in the token)
 *   Leg 2: Cash tokens (tokenized HKD) from buyer → seller
 *
 * If either leg fails, the entire transaction reverts — zero settlement risk.
 *
 * Pre-conditions for executeSettlement():
 *   - Seller must have approved this contract for ≥ tokenAmount of securityToken
 *   - Buyer must have approved this contract for ≥ cashAmount of cashToken
 *
 * Settlement lifecycle:
 *   Pending → Settled | Failed | Cancelled
 *
 * Access Control:
 *   DEFAULT_ADMIN_ROLE — platform admin
 *   OPERATOR_ROLE      — off-chain matching engine; creates and executes settlements
 *   PAUSER_ROLE        — emergency pause (SFC regulatory requirement)
 */
contract DvPSettlement is ReentrancyGuard, Pausable, AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");

    // -------------------------------------------------------------------------
    // Data structures
    // -------------------------------------------------------------------------

    enum SettlementStatus { Pending, Settled, Failed, Cancelled }

    struct Settlement {
        address seller;             // Seller wallet (holds security tokens)
        address buyer;              // Buyer wallet (holds cash tokens)
        address securityToken;      // HKSTPSecurityToken contract address
        uint256 tokenAmount;        // Fractional equity units to deliver
        address cashToken;          // Tokenized HKD ERC-20 contract address
        uint256 cashAmount;         // Price in tokenized HKD
        uint256 tradeTimestamp;     // Block timestamp when created
        uint256 settlementDeadline; // Unix timestamp; execution must occur before this
        SettlementStatus status;
        bytes32 matchId;            // Off-chain matching engine trade ID
    }

    /**
     * @notice FATF Recommendation 16 / HKMA Travel Rule data.
     *         For transfers ≥ HK$8,000, originator and beneficiary VASP
     *         information must be exchanged and recorded on-chain.
     *         The actual PII is kept off-chain; only hashes and VASP IDs
     *         are stored here.
     */
    struct TravelRuleData {
        bytes32 originatorVASP;       // keccak256 of originator VASP identifier
        bytes32 beneficiaryVASP;      // keccak256 of beneficiary VASP identifier
        bytes32 originatorInfoHash;   // keccak256 of originator name + account
        bytes32 beneficiaryInfoHash;  // keccak256 of beneficiary name + account
        uint256 timestamp;            // when travel rule data was recorded
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    mapping(uint256 => Settlement) public settlements;
    uint256 public settlementCount;

    /// @dev settlementId => TravelRuleData (FATF Rec. 16)
    mapping(uint256 => TravelRuleData) private _travelRuleData;
    /// @dev settlementId => whether travel rule data has been set
    mapping(uint256 => bool) public hasTravelRuleData;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event SettlementCreated(
        uint256 indexed id,
        bytes32 indexed matchId,
        address indexed seller,
        address buyer,
        address securityToken,
        uint256 tokenAmount,
        address cashToken,
        uint256 cashAmount,
        uint256 deadline
    );
    event SettlementExecuted(
        uint256 indexed id,
        bytes32 indexed matchId,
        address seller,
        address buyer,
        uint256 timestamp
    );
    event SettlementCancelled(
        uint256 indexed id,
        bytes32 indexed matchId,
        address indexed cancelledBy
    );
    event SettlementFailed(
        uint256 indexed id,
        bytes32 indexed matchId,
        string reason
    );
    event TravelRuleDataRecorded(
        uint256 indexed settlementId,
        bytes32 originatorVASP,
        bytes32 beneficiaryVASP,
        bytes32 originatorInfoHash,
        bytes32 beneficiaryInfoHash,
        uint256 timestamp
    );

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param admin Address granted DEFAULT_ADMIN_ROLE, OPERATOR_ROLE, and PAUSER_ROLE.
     */
    constructor(address admin) {
        require(admin != address(0), "DvPSettlement: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    // -------------------------------------------------------------------------
    // Settlement lifecycle
    // -------------------------------------------------------------------------

    /**
     * @notice Create a new settlement instruction from the off-chain matching engine.
     * @param seller        Seller wallet address.
     * @param buyer         Buyer wallet address.
     * @param securityToken HKSTPSecurityToken contract address.
     * @param tokenAmount   Security token amount (fractional equity units).
     * @param cashToken     Tokenized HKD ERC-20 contract address.
     * @param cashAmount    Cash consideration in tokenized HKD.
     * @param deadline      Unix timestamp deadline for settlement execution.
     * @param matchId       Unique trade ID from the off-chain matching engine.
     * @return id Settlement ID.
     */
    function createSettlement(
        address seller,
        address buyer,
        address securityToken,
        uint256 tokenAmount,
        address cashToken,
        uint256 cashAmount,
        uint256 deadline,
        bytes32 matchId
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused returns (uint256 id) {
        require(seller != address(0),        "DvPSettlement: zero seller");
        require(buyer  != address(0),        "DvPSettlement: zero buyer");
        require(securityToken != address(0), "DvPSettlement: zero security token");
        require(cashToken     != address(0), "DvPSettlement: zero cash token");
        require(tokenAmount   >  0,          "DvPSettlement: zero token amount");
        require(cashAmount    >  0,          "DvPSettlement: zero cash amount");
        require(deadline > block.timestamp,  "DvPSettlement: deadline in past");

        id = settlementCount++;
        settlements[id] = Settlement({
            seller:             seller,
            buyer:              buyer,
            securityToken:      securityToken,
            tokenAmount:        tokenAmount,
            cashToken:          cashToken,
            cashAmount:         cashAmount,
            tradeTimestamp:     block.timestamp,
            settlementDeadline: deadline,
            status:             SettlementStatus.Pending,
            matchId:            matchId
        });

        emit SettlementCreated(
            id, matchId, seller, buyer,
            securityToken, tokenAmount,
            cashToken, cashAmount, deadline
        );
    }

    /**
     * @notice Execute an atomic DvP settlement.
     *         Both legs succeed or both revert — zero settlement risk.
     *
     * Leg 1: seller → buyer (security tokens)
     * Leg 2: buyer  → seller (cash tokens)
     *
     * @param id Settlement ID returned by createSettlement().
     */
    function executeSettlement(uint256 id)
        external
        onlyRole(OPERATOR_ROLE)
        nonReentrant
        whenNotPaused
    {
        Settlement storage s = settlements[id];
        require(s.status == SettlementStatus.Pending, "DvPSettlement: not pending");
        require(block.timestamp <= s.settlementDeadline, "DvPSettlement: deadline passed");

        // Mark settled BEFORE external calls (checks-effects-interactions)
        s.status = SettlementStatus.Settled;

        // Leg 1: Security token delivery — seller → buyer
        // The token's _update hook internally invokes T-REX compliance checks.
        bool leg1 = IERC20(s.securityToken).transferFrom(
            s.seller, s.buyer, s.tokenAmount
        );
        require(leg1, "DvPSettlement: security token transfer failed");

        // Leg 2: Cash payment — buyer → seller
        bool leg2 = IERC20(s.cashToken).transferFrom(
            s.buyer, s.seller, s.cashAmount
        );
        require(leg2, "DvPSettlement: cash token transfer failed");

        emit SettlementExecuted(id, s.matchId, s.seller, s.buyer, block.timestamp);
    }

    /**
     * @notice Cancel a pending settlement (e.g., order withdrawn before settlement).
     * @param id Settlement ID.
     */
    function cancelSettlement(uint256 id) external onlyRole(OPERATOR_ROLE) {
        Settlement storage s = settlements[id];
        require(s.status == SettlementStatus.Pending, "DvPSettlement: not pending");
        s.status = SettlementStatus.Cancelled;
        emit SettlementCancelled(id, s.matchId, msg.sender);
    }

    /**
     * @notice Mark an expired settlement as Failed after its deadline has passed.
     *         Anyone may call this to tidy up stale settlement entries.
     * @param id Settlement ID.
     */
    function markFailed(uint256 id) external {
        Settlement storage s = settlements[id];
        require(s.status == SettlementStatus.Pending, "DvPSettlement: not pending");
        require(block.timestamp > s.settlementDeadline, "DvPSettlement: deadline not passed");
        s.status = SettlementStatus.Failed;
        emit SettlementFailed(id, s.matchId, "Deadline passed");
    }

    // -------------------------------------------------------------------------
    // FATF Recommendation 16 — Travel Rule (OPERATOR_ROLE)
    // -------------------------------------------------------------------------

    /**
     * @notice Record Travel Rule data for a settlement (FATF Rec. 16 / HKMA).
     *         Must be called before executeSettlement() for transfers ≥ HK$8,000.
     *         Only hashes and VASP IDs are stored on-chain — no PII.
     *
     * @param settlementId        The settlement to attach travel rule data to.
     * @param originatorVASP      keccak256 of originator VASP identifier.
     * @param beneficiaryVASP     keccak256 of beneficiary VASP identifier.
     * @param originatorInfoHash  keccak256 of originator name + account details.
     * @param beneficiaryInfoHash keccak256 of beneficiary name + account details.
     */
    function setTravelRuleData(
        uint256 settlementId,
        bytes32 originatorVASP,
        bytes32 beneficiaryVASP,
        bytes32 originatorInfoHash,
        bytes32 beneficiaryInfoHash
    ) external onlyRole(OPERATOR_ROLE) {
        require(settlementId < settlementCount, "DvPSettlement: invalid settlement ID");
        Settlement storage s = settlements[settlementId];
        require(s.status == SettlementStatus.Pending, "DvPSettlement: not pending");
        require(originatorVASP != bytes32(0), "DvPSettlement: zero originator VASP");
        require(beneficiaryVASP != bytes32(0), "DvPSettlement: zero beneficiary VASP");
        require(originatorInfoHash != bytes32(0), "DvPSettlement: zero originator info");
        require(beneficiaryInfoHash != bytes32(0), "DvPSettlement: zero beneficiary info");

        _travelRuleData[settlementId] = TravelRuleData({
            originatorVASP:      originatorVASP,
            beneficiaryVASP:     beneficiaryVASP,
            originatorInfoHash:  originatorInfoHash,
            beneficiaryInfoHash: beneficiaryInfoHash,
            timestamp:           block.timestamp
        });
        hasTravelRuleData[settlementId] = true;

        emit TravelRuleDataRecorded(
            settlementId,
            originatorVASP,
            beneficiaryVASP,
            originatorInfoHash,
            beneficiaryInfoHash,
            block.timestamp
        );
    }

    /**
     * @notice Retrieve Travel Rule data for a settlement.
     * @param settlementId The settlement ID.
     * @return data The TravelRuleData struct.
     */
    function getTravelRuleData(uint256 settlementId) external view returns (TravelRuleData memory data) {
        require(hasTravelRuleData[settlementId], "DvPSettlement: no travel rule data");
        return _travelRuleData[settlementId];
    }

    // -------------------------------------------------------------------------
    // Pause (PAUSER_ROLE)
    // -------------------------------------------------------------------------

    /// @notice Pause all settlement operations (SFC regulatory requirement).
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }

    /// @notice Resume settlement operations after regulatory clearance.
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // -------------------------------------------------------------------------
    // View helpers
    // -------------------------------------------------------------------------

    /**
     * @notice Returns the full Settlement struct for a given ID.
     */
    function getSettlement(uint256 id) external view returns (Settlement memory) {
        return settlements[id];
    }
}
