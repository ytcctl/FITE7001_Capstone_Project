// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MultiSigWarm
 * @notice Configurable multi-signature wallet for Warm Wallet rebalancing operations.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Warm Wallet Multi-Sig (SFC/VASP Compliant)                     │
 * ├──────────────────────────────────────────────────────────────────┤
 * │  The warm wallet acts as a transient buffer between hot and      │
 * │  cold storage.  All fund movements through the warm wallet       │
 * │  require M-of-N approval from designated signers.                │
 * │                                                                  │
 * │  Workflow:                                                       │
 * │   1. Any signer proposes a transfer (proposeTx)                  │
 * │   2. Additional signers confirm (confirmTx)                      │
 * │   3. Once threshold met, any signer can execute (executeTx)      │
 * │                                                                  │
 * │  Transactions auto-expire after EXPIRY_PERIOD (48 hours).        │
 * └──────────────────────────────────────────────────────────────────┘
 */
contract MultiSigWarm is ReentrancyGuard {
    // ─── Configuration ──────────────────────────────────────────
    uint256 public REQUIRED_CONFIRMATIONS;
    uint256 public MAX_SIGNERS;
    uint256 public constant EXPIRY_PERIOD = 48 hours;

    // ─── State ──────────────────────────────────────────────────
    address[] public signerList;
    mapping(address => bool) public isSigner;
    address public admin;

    struct Transaction {
        address token;       // ERC-20 to transfer (address(0) = native ETH)
        address to;          // Destination wallet
        uint256 amount;      // Amount to transfer
        string  reason;      // "sweep-to-cold" | "replenish-hot" | "withdrawal"
        uint256 proposedAt;  // Timestamp of proposal
        bool    executed;    // Whether executed
        bool    cancelled;   // Whether cancelled
        uint256 confirmations; // Number of confirmations
    }

    Transaction[] public transactions;
    /// @dev txId => signer => confirmed
    mapping(uint256 => mapping(address => bool)) public confirmed;

    // ─── Events ─────────────────────────────────────────────────
    event TxProposed(uint256 indexed txId, address indexed proposer, address token, address to, uint256 amount, string reason);
    event TxConfirmed(uint256 indexed txId, address indexed signer);
    event TxRevoked(uint256 indexed txId, address indexed signer);
    event TxExecuted(uint256 indexed txId, address indexed executor);
    event TxCancelled(uint256 indexed txId, address indexed canceller);
    event SignerReplaced(uint256 indexed index, address indexed oldSigner, address indexed newSigner);
    event SignerAdded(address indexed newSigner, uint256 totalSigners);
    event SignerRemoved(address indexed removedSigner, uint256 totalSigners);
    event ThresholdChanged(uint256 oldThreshold, uint256 newThreshold);

    // ─── Modifiers ──────────────────────────────────────────────
    modifier onlySigner() {
        require(isSigner[msg.sender], "MultiSigWarm: not a signer");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "MultiSigWarm: not admin");
        _;
    }

    modifier txExists(uint256 txId) {
        require(txId < transactions.length, "MultiSigWarm: tx does not exist");
        _;
    }

    modifier notExecuted(uint256 txId) {
        require(!transactions[txId].executed, "MultiSigWarm: already executed");
        _;
    }

    modifier notCancelled(uint256 txId) {
        require(!transactions[txId].cancelled, "MultiSigWarm: already cancelled");
        _;
    }

    modifier notExpired(uint256 txId) {
        require(
            block.timestamp <= transactions[txId].proposedAt + EXPIRY_PERIOD,
            "MultiSigWarm: transaction expired"
        );
        _;
    }

    // ─── Constructor ────────────────────────────────────────────

    /**
     * @param signers_ Array of initial signer addresses.
     * @param requiredConfirmations_ Number of confirmations required to execute.
     */
    constructor(address[] memory signers_, uint256 requiredConfirmations_) {
        require(signers_.length >= 2, "MultiSigWarm: need at least 2 signers");
        require(requiredConfirmations_ >= 2, "MultiSigWarm: threshold must be >= 2");
        require(requiredConfirmations_ <= signers_.length, "MultiSigWarm: threshold > signers");
        for (uint256 i = 0; i < signers_.length; i++) {
            require(signers_[i] != address(0), "MultiSigWarm: zero signer");
            for (uint256 j = 0; j < i; j++) {
                require(signers_[i] != signers_[j], "MultiSigWarm: duplicate signer");
            }
            signerList.push(signers_[i]);
            isSigner[signers_[i]] = true;
        }
        MAX_SIGNERS = signers_.length;
        REQUIRED_CONFIRMATIONS = requiredConfirmations_;
        admin = msg.sender;
    }

    // ─── Propose ────────────────────────────────────────────────

    /**
     * @notice Propose a new transfer.  The proposer automatically confirms.
     * @param token   ERC-20 token to transfer.
     * @param to      Destination address.
     * @param amount  Amount to transfer.
     * @param reason  Human-readable reason for the transfer.
     * @return txId   The transaction ID.
     */
    function proposeTx(
        address token,
        address to,
        uint256 amount,
        string calldata reason
    ) external onlySigner returns (uint256 txId) {
        require(to != address(0), "MultiSigWarm: zero destination");
        require(amount > 0, "MultiSigWarm: zero amount");

        txId = transactions.length;
        transactions.push(Transaction({
            token: token,
            to: to,
            amount: amount,
            reason: reason,
            proposedAt: block.timestamp,
            executed: false,
            cancelled: false,
            confirmations: 1 // proposer auto-confirms
        }));
        confirmed[txId][msg.sender] = true;

        emit TxProposed(txId, msg.sender, token, to, amount, reason);
        emit TxConfirmed(txId, msg.sender);
    }

    // ─── Confirm ────────────────────────────────────────────────

    /**
     * @notice Confirm a pending transaction.
     * @param txId The transaction ID to confirm.
     */
    function confirmTx(uint256 txId)
        external
        onlySigner
        txExists(txId)
        notExecuted(txId)
        notCancelled(txId)
        notExpired(txId)
    {
        require(!confirmed[txId][msg.sender], "MultiSigWarm: already confirmed");
        confirmed[txId][msg.sender] = true;
        transactions[txId].confirmations++;
        emit TxConfirmed(txId, msg.sender);
    }

    // ─── Revoke Confirmation ────────────────────────────────────

    /**
     * @notice Revoke your confirmation on a pending transaction.
     * @param txId The transaction ID.
     */
    function revokeConfirmation(uint256 txId)
        external
        onlySigner
        txExists(txId)
        notExecuted(txId)
        notCancelled(txId)
    {
        require(confirmed[txId][msg.sender], "MultiSigWarm: not confirmed");
        confirmed[txId][msg.sender] = false;
        transactions[txId].confirmations--;
        emit TxRevoked(txId, msg.sender);
    }

    // ─── Execute ────────────────────────────────────────────────

    /**
     * @notice Execute a fully-confirmed transaction.
     *         Requires >= REQUIRED_CONFIRMATIONS approvals.
     *         The MultiSigWarm contract must hold sufficient token balance.
     * @param txId The transaction ID.
     */
    function executeTx(uint256 txId)
        external
        nonReentrant
        onlySigner
        txExists(txId)
        notExecuted(txId)
        notCancelled(txId)
        notExpired(txId)
    {
        Transaction storage t = transactions[txId];
        require(
            t.confirmations >= REQUIRED_CONFIRMATIONS,
            "MultiSigWarm: insufficient confirmations"
        );

        t.executed = true;

        // Execute ERC-20 transfer
        bool success = IERC20(t.token).transfer(t.to, t.amount);
        require(success, "MultiSigWarm: transfer failed");

        emit TxExecuted(txId, msg.sender);
    }

    // ─── Cancel ─────────────────────────────────────────────────

    /**
     * @notice Cancel a pending transaction.  Any signer can cancel.
     * @param txId The transaction ID.
     */
    function cancelTx(uint256 txId)
        external
        onlySigner
        txExists(txId)
        notExecuted(txId)
        notCancelled(txId)
    {
        transactions[txId].cancelled = true;
        emit TxCancelled(txId, msg.sender);
    }

    // ─── Signer Management ─────────────────────────────────────

    /**
     * @notice Replace a signer at a given index.
     * @param index      The signer index to replace.
     * @param newSigner  The new signer address.
     */
    function replaceSigner(uint256 index, address newSigner) external onlyAdmin {
        require(index < signerList.length, "MultiSigWarm: invalid index");
        require(newSigner != address(0), "MultiSigWarm: zero address");
        require(!isSigner[newSigner], "MultiSigWarm: already a signer");

        address oldSigner = signerList[index];
        isSigner[oldSigner] = false;
        isSigner[newSigner] = true;
        signerList[index] = newSigner;

        emit SignerReplaced(index, oldSigner, newSigner);
    }

    /**
     * @notice Add a new signer.
     * @param newSigner  The new signer address.
     */
    function addSigner(address newSigner) external onlyAdmin {
        require(newSigner != address(0), "MultiSigWarm: zero address");
        require(!isSigner[newSigner], "MultiSigWarm: already a signer");
        signerList.push(newSigner);
        isSigner[newSigner] = true;
        MAX_SIGNERS = signerList.length;
        emit SignerAdded(newSigner, signerList.length);
    }

    /**
     * @notice Remove a signer by index.
     * @param index The signer index to remove.
     */
    function removeSigner(uint256 index) external onlyAdmin {
        require(index < signerList.length, "MultiSigWarm: invalid index");
        require(signerList.length > REQUIRED_CONFIRMATIONS, "MultiSigWarm: cannot go below threshold");

        address removed = signerList[index];
        isSigner[removed] = false;
        // Swap with last element and pop
        signerList[index] = signerList[signerList.length - 1];
        signerList.pop();
        MAX_SIGNERS = signerList.length;
        emit SignerRemoved(removed, signerList.length);
    }

    /**
     * @notice Update the confirmation threshold.
     * @param newThreshold The new required confirmations.
     */
    function setThreshold(uint256 newThreshold) external onlyAdmin {
        require(newThreshold >= 2, "MultiSigWarm: threshold must be >= 2");
        require(newThreshold <= signerList.length, "MultiSigWarm: threshold > signers");
        uint256 old = REQUIRED_CONFIRMATIONS;
        REQUIRED_CONFIRMATIONS = newThreshold;
        emit ThresholdChanged(old, newThreshold);
    }

    // ─── View Helpers ───────────────────────────────────────────

    /**
     * @notice Total number of transactions (proposed + executed + cancelled).
     */
    function transactionCount() external view returns (uint256) {
        return transactions.length;
    }

    /**
     * @notice Returns the list of all signers.
     */
    function getSigners() external view returns (address[] memory) {
        return signerList;
    }

    /**
     * @notice Compatibility: get signer by index (replaces old signers(uint256) accessor).
     */
    function signers(uint256 index) external view returns (address) {
        require(index < signerList.length, "MultiSigWarm: invalid index");
        return signerList[index];
    }

    /**
     * @notice Returns pending (unexecuted, uncancelled, not-expired) transaction count.
     */
    function pendingCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < transactions.length; i++) {
            Transaction storage t = transactions[i];
            if (!t.executed && !t.cancelled && block.timestamp <= t.proposedAt + EXPIRY_PERIOD) {
                count++;
            }
        }
    }

    /**
     * @notice Check if a transaction is expired.
     */
    function isExpired(uint256 txId) external view returns (bool) {
        require(txId < transactions.length, "MultiSigWarm: tx does not exist");
        return block.timestamp > transactions[txId].proposedAt + EXPIRY_PERIOD;
    }

    /**
     * @notice Receive ETH (for native token transfers if needed).
     */
    receive() external payable {}

    /**
     * @notice Withdraw accidentally locked ETH from the contract.
     *         Requires full multi-sig confirmation like any other transaction.
     * @param to        Recipient of the ETH.
     * @param amount    Amount of ETH (in wei) to withdraw.
     */
    function withdrawETH(address payable to, uint256 amount) external onlySigner {
        require(to != address(0), "MultiSigWarm: zero address");
        require(amount <= address(this).balance, "MultiSigWarm: insufficient balance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "MultiSigWarm: ETH transfer failed");
    }
}
