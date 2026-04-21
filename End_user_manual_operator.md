# TokenHub — Operator End-User Manual

> HKSTP Security Token Platform · Operator Guide  
> Version 1.0 · April 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [What Is the Operator Role?](#2-what-is-the-operator-role)
3. [System Prerequisites](#3-system-prerequisites)
4. [Starting the Platform](#4-starting-the-platform)
5. [Connecting as Operator](#5-connecting-as-operator)
6. [Navigation — Pages Available to You](#6-navigation--pages-available-to-you)
7. [Dashboard](#7-dashboard)
8. [End-to-End Workflow: Creating and Executing a DvP Settlement](#8-end-to-end-workflow-creating-and-executing-a-dvp-settlement)
   - 8.1 [Step 1 — Create a Settlement Instruction](#81-step-1--create-a-settlement-instruction)
   - 8.2 [Step 2 — Counterparties Approve Tokens](#82-step-2--counterparties-approve-tokens)
   - 8.3 [Step 3 — Execute the Settlement](#83-step-3--execute-the-settlement)
   - 8.4 [Step 4 — Record Travel Rule Data (FATF Rec. 16)](#84-step-4--record-travel-rule-data-fatf-rec-16)
   - 8.5 [Handling Failures and Cancellations](#85-handling-failures-and-cancellations)
9. [End-to-End Workflow: Batch Settlement Execution](#9-end-to-end-workflow-batch-settlement-execution)
10. [End-to-End Workflow: Custody Operations](#10-end-to-end-workflow-custody-operations)
    - 10.1 [Understanding the Wallet Tier System](#101-understanding-the-wallet-tier-system)
    - 10.2 [Monitoring Custody Compliance](#102-monitoring-custody-compliance)
    - 10.3 [Proposing a Warm Wallet Transfer](#103-proposing-a-warm-wallet-transfer)
    - 10.4 [Confirming and Executing Multi-Sig Transfers](#104-confirming-and-executing-multi-sig-transfers)
    - 10.5 [Sweep / Rebalance Audit Trail](#105-sweep--rebalance-audit-trail)
11. [End-to-End Workflow: Oracle Committee Management](#11-end-to-end-workflow-oracle-committee-management)
12. [Page Reference](#12-page-reference)
    - 12.1 [DvP Settlement](#121-dvp-settlement)
    - 12.2 [Wallet Custody](#122-wallet-custody)
    - 12.3 [Oracle Committee](#123-oracle-committee)
    - 12.4 [Trading](#124-trading)
    - 12.5 [Governance](#125-governance)
    - 12.6 [Portfolio](#126-portfolio)
13. [What You Cannot Do (Admin/Agent-Only)](#13-what-you-cannot-do-adminagent-only)
14. [Dual-Control Rule](#14-dual-control-rule)
15. [Troubleshooting](#15-troubleshooting)

---

## 1. Overview

**TokenHub** is an end-to-end security token issuance, trading, and settlement platform for HKSTP (Hong Kong Science & Technology Parks) startup companies. The platform runs on an EVM blockchain and provides on-chain identity management, compliance enforcement, order-book trading, delivery-versus-payment settlement, and governance.

This manual is written for the **Operator** role — the staff responsible for settlement operations, custody management, and oracle committee oversight.

---

## 2. What Is the Operator Role?

The Operator is a privileged staff role focused on **post-trade operations**:

| Responsibility | Description |
|---------------|-------------|
| **DvP Settlement** | Create, execute, cancel, and batch-execute delivery-versus-payment settlements |
| **Travel Rule Compliance** | Record FATF Recommendation 16 travel rule data on settlements |
| **Custody Operations** | Monitor wallet tiers, propose and confirm multi-sig warm wallet transfers, record sweeps |
| **Oracle Committee** | View and manage multi-oracle compliance attestation members and thresholds |

### Key Principle: Dual Control

The DvP Settlement contract enforces a **dual-control rule**: the operator who creates a settlement **cannot** be the same operator who executes it. This separation of duties prevents single-point-of-failure risk in settlement operations.

---

## 3. System Prerequisites

| Component | Requirement |
|-----------|-------------|
| **Browser** | Chrome or Firefox with MetaMask extension |
| **MetaMask** | Network configured for Chain ID `31337`, RPC `http://127.0.0.1:8545` |
| **Platform** | TokenHub frontend running at `http://localhost:3000/` (or tunnel URL) |
| **Blockchain** | Anvil node running with contracts deployed |

### Default Operator Account

| Field | Value |
|-------|-------|
| Label | Operator |
| Address | `0x627306090abaB3A6e1400e9345bC60c78a8BEf57` |
| Private Key | `0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3` |
| Roles | `OPERATOR_ROLE` |

> **Note:** This is a well-known Hardhat/Besu test key. Never use it on a public network.

---

## 4. Starting the Platform

> If the platform is already running (started by an admin or DevOps), skip to [Section 5](#5-connecting-as-operator).

### 4.1 Start the Blockchain Node

```powershell
anvil --host 0.0.0.0 --port 8545 --no-request-size-limit
```

### 4.2 Load State Snapshot

```powershell
node -e "
  const fs = require('fs');
  const { ethers } = require('ethers');
  const p = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const data = fs.readFileSync('anvil-snapshot-2026-04-18T16-58-42.json','utf8');
  const hex = JSON.parse(data);
  p.send('anvil_loadState', [hex]).then(() => console.log('State loaded'));
"
```

### 4.3 Fix the Blockchain Clock

```powershell
node -e "
  const { ethers } = require('ethers');
  const p = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  (async () => {
    const latest = await p.getBlock('latest');
    const target = Math.max(latest.timestamp, Math.floor(Date.now()/1000)) + 172800;
    await p.send('evm_setNextBlockTimestamp', ['0x' + target.toString(16)]);
    await p.send('evm_mine', []);
    const b = await p.getBlock('latest');
    console.log('Clock fixed. Block', b.number, 'at', new Date(b.timestamp*1000).toISOString());
  })();
"
```

### 4.4 Start the Frontend

```powershell
cd frontend
npm run dev
```

Open **http://localhost:3000/** in your browser.

---

## 5. Connecting as Operator

1. Open **http://localhost:3000/** in your browser
2. In the sidebar (bottom), click **"Connect Wallet"**
3. A dropdown appears with connection options. Choose one:

   **Option A — Built-in Test Account (Recommended for Development)**
   - Under the **"Built-in Test Accounts"** section, click **Operator**
   - This connects with address `0x627306090abaB3A6e1400e9345bC60c78a8BEf57`

   **Option B — MetaMask**
   - Click **MetaMask** (orange icon)
   - MetaMask pops up — select or import the Operator account
   - Approve the connection

   **Option C — Custom Private Key**
   - Expand the **"Custom Private Key"** section
   - Enter a label (e.g., `Operator`)
   - Paste the Operator private key
   - Click **"Connect & Save"**

4. After connecting, the sidebar shows:
   - `Connected (Built-in)` or `Connected (MetaMask)`
   - Address: `0x6273…Ef57 · Chain 31337`
   - Role badge: **OPERATOR** (green)

### Wrong Network Warning

If your browser wallet is on a different network, a red banner appears:

> "Wrong network detected (Chain ID: ?). Please switch to Hardhat Devnet (Chain ID: 31337)."

Click **"Switch Network"** to auto-configure (MetaMask only).

---

## 6. Navigation — Pages Available to You

As an Operator, these sidebar items are visible:

| Sidebar Label | Badge | Description |
|--------------|-------|-------------|
| **Dashboard** | — | Overview, balances, KYC status, market stats |
| **DvP Settlement** | — | Create, execute, cancel, batch-execute settlements |
| **Trading** | — | View markets and place orders |
| **Oracle Committee** | `Privileged` | View and manage oracle members and threshold |
| **Wallet Custody** | `Privileged` | Monitor custody tiers, multi-sig warm wallet operations |
| **Governance** | — | View and vote on governance proposals |
| **Portfolio** | — | View your own token holdings |

Pages you will **not** see (Admin/Agent-only): KYC Management, Token Minting, Token Management, Market Management, Compliance Rules, Freeze Management, Mint ETH (Test).

---

## 7. Dashboard

After connecting, the Dashboard shows the following sections:

### My Token Holdings
- Your security token balance (e.g., HKSAT) with last market price
- Your cash token balance (Tokenized HKD / THKD)
- Balances for any factory-deployed tokens

### KYC / AML Claims
Your own KYC status and claim topics (1–6):

| Topic | Name |
|-------|------|
| 1 | KYC Verified |
| 2 | Accredited Investor |
| 3 | Jurisdiction Approved |
| 4 | Source of Funds |
| 5 | PEP/Sanctions Clear |
| 6 | FPS Name-Match |

### Market Overview
Table of active order-book markets with columns: **Market**, **Last Price**, **Best Bid**, **Best Ask**, **Trades**.

> **Note:** The Admin-only stat cards (total supply) and System Health Check panel are not visible to Operators.

---

## 8. End-to-End Workflow: Creating and Executing a DvP Settlement

This is the primary Operator workflow — managing the atomic exchange of security tokens for cash between a seller and buyer.

### Settlement Lifecycle

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Operator A  │     │  Parties     │     │  Operator B  │
│   Creates     │────▶│  Approve     │────▶│  Executes    │
│   Settlement  │     │  Tokens      │     │  Settlement  │
└──────────────┘     └──────────────┘     └──────────────┘
      │                                          │
      ▼                                          ▼
   Pending ─────────────────────────────────▶ Settled
      │                                          
      ├──▶ Cancelled (by operator or party)
      └──▶ Expired ──▶ Failed (marked by anyone)
```

> **Dual-control rule:** The operator who creates a settlement cannot execute it. A different operator (or the Admin) must execute.

---

### 8.1 Step 1 — Create a Settlement Instruction

**Navigate to:** Sidebar → **DvP Settlement**

1. In the **Create Settlement** section, fill in:

   | Field | What to Enter | Example |
   |-------|--------------|---------|
   | **Seller Address** | The seller's Ethereum address | `0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef` |
   | **Buyer Address** | The buyer's Ethereum address | `0x821aEa9a577a9b44299B9c15c88cf3087F3b5544` |
   | **Security Token** | Select from dropdown | `HKSAT — HKSTP Alpha Startup Token` |
   | **Security Token Amount** | Number of tokens to transfer | `100` |
   | **Cash Amount (THKD)** | Cash consideration in THKD | `50000` |
   | **Deadline (hours from now)** | Expiry window | `24` |

2. Click **"Create Settlement"**

3. The system performs validation:
   - Checks both addresses are valid Ethereum addresses
   - Checks neither address is frozen by compliance
   - If your connected wallet is the seller or buyer, auto-approves the relevant token

4. Status messages during creation:
   - *"Approving security token for DvP…"* (if you are the seller)
   - *"Approving cash token for DvP…"* (if you are the buyer)
   - *"Creating settlement…"*
   - **"✓ Settlement created successfully"**

5. The new settlement appears in the **Settlement History** table below with status **Pending** (amber badge)

### Validation Error Messages

| Error | Meaning |
|-------|---------|
| *"Invalid seller address"* | Address is not a valid `0x…` format |
| *"Invalid buyer address"* | Address is not a valid `0x…` format |
| *"Seller address is frozen by the compliance administrator"* | Seller is frozen — contact Agent to resolve |
| *"Buyer address is frozen by the compliance administrator"* | Buyer is frozen — contact Agent to resolve |

---

### 8.2 Step 2 — Counterparties Approve Tokens

Before execution, both counterparties must approve their tokens to the DvP contract:

- **Seller** must approve sufficient **security tokens** (e.g., 100 HKSAT)
- **Buyer** must approve sufficient **cash tokens** (e.g., 50,000 THKD)

The system handles this automatically when:
- The **seller** connects their wallet and clicks "Execute" — auto-approves security tokens
- The **buyer** connects their wallet and clicks "Execute" — auto-approves cash tokens

If neither party is the executing operator, the parties must approve through the Trading page or directly via their wallets.

---

### 8.3 Step 3 — Execute the Settlement

> **Reminder:** Due to dual-control, a **different** operator must execute the settlement than the one who created it.

1. In the **Settlement History** table, find the pending settlement
2. If you created it, the Actions column shows *"Awaiting counterparty"* (you cannot execute)
3. If another operator created it, you see:
   - **"Execute"** button (green) — execute the atomic DvP swap
   - **"Cancel"** button (red) — cancel the settlement

4. Click **"Execute"**

5. The system runs pre-flight compliance checks on-chain:
   - Verifies the seller has sufficient security tokens
   - Verifies the buyer has sufficient cash tokens
   - Verifies both parties are registered and KYC-verified
   - Verifies neither party is frozen
   - Verifies the seller is not under lock-up

6. If all checks pass, the atomic swap executes:
   - Security tokens transfer: Seller → Buyer
   - Cash tokens transfer: Buyer → Seller
   - Both transfers happen in a single transaction (atomic — both succeed or both fail)

7. Success message: **"✓ Settlement #{id} executed — DvP atomic swap complete"**
8. The settlement status changes to **Settled** (green badge)

### Pre-Flight Failure Reasons

If execution fails, the settlement is marked as **Failed** and the reason is recorded:

| Reason | Meaning |
|--------|---------|
| *"Seller has insufficient security tokens"* | Seller's balance is too low |
| *"Buyer has insufficient cash tokens"* | Buyer's THKD balance is too low |
| *"Seller is not registered or verified"* | Seller's KYC is incomplete |
| *"Buyer is not registered or verified"* | Buyer's KYC is incomplete |
| *"Seller address is frozen"* | Seller was frozen since settlement creation |
| *"Buyer address is frozen"* | Buyer was frozen since settlement creation |
| *"Seller is under lock-up period"* | Seller's tokens are locked |

### Execution Error Messages (UI)

| Error | Meaning |
|-------|---------|
| *"Only the counterparty can execute this DvP settlement"* | You created this settlement — dual-control violation |
| *"Seller has not approved security tokens to the DvP contract"* | Seller must connect and approve first |
| *"Buyer has not approved sufficient cash tokens to the DvP contract"* | Buyer must connect and approve first |
| *"Insufficient token balance"* | Token balance check failed |
| *"Insufficient allowance"* | Token approval check failed |
| *"Token transfer failed — sender or recipient may be frozen or not KYC-verified"* | Compliance check blocked the transfer |

---

### 8.4 Step 4 — Record Travel Rule Data (FATF Rec. 16)

After settlement execution, record travel rule data for regulatory compliance:

This is done via the smart contract directly (not exposed in the UI):

```javascript
await dvpSettlement.setTravelRuleData(
  settlementId,
  originatorVASP,       // keccak256 of originator VASP identifier
  beneficiaryVASP,      // keccak256 of beneficiary VASP identifier
  originatorInfoHash,   // keccak256 of originator name + account
  beneficiaryInfoHash   // keccak256 of beneficiary name + account
);
```

The `TravelRuleDataRecorded` event is emitted for audit purposes.

> **FATF Rec. 16 / HKMA requirement:** For virtual asset transfers above the threshold, originator and beneficiary information must be recorded and available to authorities.

---

### 8.5 Handling Failures and Cancellations

#### Cancel a Pending Settlement

1. In the **Settlement History** table, find the pending settlement
2. Click **"Cancel"** (red button)
3. The settlement status changes to **Cancelled** (gray badge)

#### Mark an Expired Settlement as Failed

If a settlement passes its deadline without execution:

1. The settlement status shows **Expired** (orange badge)
2. Click **"Mark Failed"** (orange button)
3. The settlement status changes to **Failed** (red badge)

> **Note:** `markFailed` is a public function — anyone can call it to clean up expired settlements.

---

## 9. End-to-End Workflow: Batch Settlement Execution

For processing multiple settlements efficiently:

1. **Navigate to:** Sidebar → **DvP Settlement**

2. In the **Settlement History** table, **check the boxes** next to multiple pending settlements

3. A batch bar appears at the top:
   > *"{N} of {M} pending settlement(s) selected"*

4. Click **"Batch Execute ({N})"** (green button)

5. The system processes all selected settlements in a single transaction:
   - Each settlement undergoes the same pre-flight compliance checks
   - Settlements that pass are executed; those that fail are recorded with reasons
   - A `BatchSettlementExecuted` event is emitted with success and failure counts

6. Success message: **"✓ Batch execute complete — {N} settlement(s) processed"**

### Batch Constraints

| Constraint | Value |
|-----------|-------|
| Maximum settlements per batch | 50 |
| Gas estimate per settlement | ~800,000 gas |
| Dual-control | Applies per settlement — you can only batch-execute settlements you did NOT create |

### Batch Error Messages

| Error | Meaning |
|-------|---------|
| *"Only Counterparty can execute the DvP settlement"* | One or more selected settlements were created by you |
| *"Seller has not approved sufficient security tokens"* | A seller hasn't approved; they must connect and approve first |
| *"Buyer has not approved sufficient cash tokens"* | A buyer hasn't approved; they must connect and approve first |

---

## 10. End-to-End Workflow: Custody Operations

### 10.1 Understanding the Wallet Tier System

**Navigate to:** Sidebar → **Wallet Custody**

The platform follows the **SFC/VASP 98/2 custody rule** with three wallet tiers:

| Tier | Label | Icon | Purpose | Security |
|------|-------|------|---------|----------|
| **Hot** (1) | 🔥 Hot | Flame (red) | Day-to-day operations | Online, subject to 2% AUM cap |
| **Warm** (2) | 🌡️ Warm | Thermometer (yellow) | Operational transfers | Multi-sig required (N-of-M) |
| **Cold** (3) | ❄️ Cold | Snowflake (blue) | Long-term storage | FIPS 140-2 L3+ HSM / Air-gapped |

### 10.2 Monitoring Custody Compliance

At the top of the Custody page:

1. Select a token from the **"Select Token"** dropdown to view tier breakdown
2. The **Tier Breakdown** shows four cards:

| Card | What It Shows |
|------|---------------|
| **Hot Wallet** | Balance, % of AUM, cap info |
| **Warm Wallet** | Balance, % of AUM, multi-sig requirement (e.g., "2-of-3 multi-sig required") |
| **Cold Storage** | Balance, % of AUM, security standard (FIPS 140-2 L3+) |
| **Compliance** | Overall status: **COMPLIANT** (green) or **OVER CAP** (red), Total AUM |

3. If the hot wallet exceeds its cap (2% of AUM), the Compliance card turns red with:
   - **"OVER CAP"** warning
   - **"Trigger Sweep Check"** button — initiates a sweep to move excess funds to cold storage

### 10.3 Proposing a Warm Wallet Transfer

If you are an authorized **signer** on the MultiSig warm wallet:

1. Scroll to the **Multi-Sig Warm Wallet** section
2. Check the **Warm Wallet Holdings** cards to verify the wallet has sufficient balance
3. In the **Propose Transfer** form:

   | Field | What to Enter | Example |
   |-------|--------------|---------|
   | **Token** | Select from dropdown | `HKSAT` |
   | **Destination Address** | Target wallet address | `0xABCD…1234` (cold wallet) |
   | **Amount** | Number of tokens to transfer | `5000` |
   | **Reason** | Select from dropdown | `Sweep to Cold` |

   Available reasons:
   - **Sweep to Cold** — move excess funds to cold storage
   - **Replenish Hot** — top up hot wallet for operations
   - **Withdrawal** — process an investor withdrawal
   - **Rebalance** — rebalance across tiers

4. Click **"Propose"**
5. Success message: *"Transaction proposed successfully"*
6. The transaction appears in the **Recent Transactions** table with status **⏳ Pending** (yellow)

### 10.4 Confirming and Executing Multi-Sig Transfers

Multi-sig transfers require multiple signers to confirm before execution.

#### Confirming

1. In the **Recent Transactions** table, find the pending transaction
2. Review the details: Token, To, Amount, Reason, current Confirmations count
3. Click **"Confirm"** (blue button)
4. Your confirmation is recorded; the Confirms count increases

> If you already confirmed, the button shows **"✓ Confirmed"** (grayed out).

#### Executing

1. Once confirmations reach the threshold (e.g., 2-of-3), the **"Execute"** button (green) becomes available
2. Click **"Execute"**
3. The transfer executes and the system automatically calls `walletRegistry.recordSweep()` for the audit trail
4. Status changes to **✓ Executed** (green)

#### Cancelling

- Click **"Cancel"** (red button) to abort a pending transaction
- Status changes to **✗ Cancelled** (red)

### Multi-Sig Error Messages

| Error | Meaning |
|-------|---------|
| *"You have already confirmed this transaction"* | A different signer must confirm |
| *"Only authorized signers can perform this action"* | Your address is not a signer |
| *"This transaction has already been executed"* | Cannot act on completed transactions |
| *"This transaction has expired (48-hour limit exceeded)"* | Propose a new transaction |
| *"Not enough confirmations yet — at least N of M signers must confirm"* | Wait for more confirmations |
| *"Insufficient warm wallet balance"* | Transfer tokens to the MultiSigWarm contract first |

### 10.5 Sweep / Rebalance Audit Trail

Scroll to the bottom of the Custody page for the **Sweep / Rebalance Audit Trail**:

| Column | Description |
|--------|-------------|
| Time | Timestamp of the operation |
| From | Source wallet address |
| To | Destination wallet address |
| Amount | Token amount transferred |
| Reason | Sweep, rebalance, withdrawal, or replenish |

This provides a complete audit log of all custody movements.

---

## 11. End-to-End Workflow: Oracle Committee Management

**Navigate to:** Sidebar → **Oracle Committee**

The Oracle Committee is a multi-oracle compliance attestation system. Transfers require **N-of-M** oracle signatures to pass compliance checks.

### Viewing Committee Status

Three summary cards at the top:

| Card | Example Value | Meaning |
|------|--------------|---------|
| **Oracle Members** | `3 / 10` | Current members out of maximum |
| **Signature Threshold** | `2-of-3` | Required signatures for compliance attestation |
| **Security Level** | `Multi-Sig` (green) | Multi-sig active (vs. Single-Sig if threshold = 1) |

### Oracle Members List

Each member shows:
- Index badge (e.g., `#1`)
- Full Ethereum address
- **"YOU"** badge if the member is your connected address
- **Remove** button (trash icon) — disabled if removal would drop below threshold

### Adding an Oracle Member

1. In the **Add Oracle Member** section, enter the **Oracle Address** (e.g., `0x1234…abcd`)
2. Click **"Add Oracle"**
3. The new member appears in the list

> Maximum members: if the cap is reached, a warning appears: *"Maximum oracles (N) reached."*

### Removing an Oracle Member

1. Click the **Remove** (trash icon) next to the member
2. Confirm the transaction

> Cannot remove if it would drop the member count below the threshold.

### Setting the Signature Threshold

1. In the **Set Signature Threshold** section, enter the **New Threshold** (minimum 2, maximum = current member count)
2. Click **"Set Threshold"**

> **Error:** *"Threshold must be at least 2"* or *"Threshold cannot exceed the number of oracle members."*

---

## 12. Page Reference

### 12.1 DvP Settlement

**Path:** `/settlement` · **Access:** All (Operator role required for create/execute)

| Section | Purpose | Key Actions |
|---------|---------|-------------|
| **Create Settlement** | Create a new DvP instruction | Fill form → "Create Settlement" |
| **Batch Execute Bar** | Process multiple settlements at once | Check boxes → "Batch Execute (N)" |
| **Settlement History** | View all settlements with status | "Execute", "Cancel", "Mark Failed" |

**Settlement Statuses:**

| Status | Badge | Meaning |
|--------|-------|---------|
| Pending | Amber | Awaiting execution |
| Settled | Green | Successfully completed |
| Failed | Red | Pre-flight check failed |
| Cancelled | Gray | Manually cancelled |
| Expired | Orange | Past deadline, awaiting mark-failed |

---

### 12.2 Wallet Custody

**Path:** `/custody` · **Access:** Admin + Agent + Operator

| Section | Purpose |
|---------|---------|
| **Token Selector** | Choose which token to view tier breakdown for |
| **Tier Breakdown** | Hot/Warm/Cold balances, AUM, compliance status |
| **Registered Wallets** | View all custody wallets and their statuses |
| **Multi-Sig Warm Wallet** | View signers, propose/confirm/execute transfers |
| **Audit Trail** | View historical sweep and rebalance operations |

> **Note:** Wallet registration, deactivation/reactivation, and signer management require Admin role. Operators can view wallets and participate as signers.

---

### 12.3 Oracle Committee

**Path:** `/oracle` · **Access:** Admin + Agent + Operator

| Section | Purpose | Key Actions |
|---------|---------|-------------|
| **Summary Cards** | Members count, threshold, security level | — |
| **Oracle Members** | List with addresses and remove buttons | "Remove" (trash icon) |
| **Add Oracle** | Add new member | Enter address → "Add Oracle" |
| **Set Threshold** | Change N-of-M requirement | Enter value → "Set Threshold" |

---

### 12.4 Trading

**Path:** `/trading` · **Access:** All

As an Operator, you can trade like any KYC-verified investor:

1. Select a market from the **market selector** dropdown
2. View market stats: Last Price, Best Bid/Ask, Spread, Total Orders, Total Trades
3. Check your balances (security token + cash)
4. Place orders:
   - Toggle **Buy** or **Sell**
   - Enter **Price (HKD per token)** and **Quantity**
   - Review the **Estimated Total**
   - Click **"Place Buy Order"** or **"Place Sell Order"**
5. View the live **Order Book** (buy orders in green, sell orders in red)
6. Manage your orders in the **My Orders** section

> **Prerequisite:** Your Operator address must be KYC-registered and verified to place orders. If you see a "KYC Verification Required" banner, contact an Admin or Agent.

---

### 12.5 Governance

**Path:** `/governance` · **Access:** All

As an Operator, you can participate in governance:

- **Delegate voting power:** Enter your address → click **"Delegate"** to self-delegate
- **Vote on proposals:** Click **For**, **Against**, or **Abstain** during the voting period
- **Create proposals:** If you hold sufficient tokens (≥ proposal threshold, typically 10,000)
  - Select type: **Signaling** (text-only) or **Executable** (on-chain action)
  - Enter description → click **"Submit Proposal"**
- **Queue / Execute** passed proposals through the Timelock

---

### 12.6 Portfolio

**Path:** `/portfolio` · **Access:** All

View your wallet's complete token holdings, balances, and transaction history.

---

## 13. What You Cannot Do (Admin/Agent-Only)

The following operations are not available to the Operator role:

| Operation | Required Role | Page |
|-----------|-------------|------|
| Register investor identities | Agent | KYC Management |
| Issue / revoke KYC claims | Agent | KYC Management |
| Compliance force-cancel | Agent | KYC Management |
| Mint security tokens | Agent | Token Minting |
| Burn security tokens | Agent | Token Minting |
| Mint / burn cash tokens (THKD) | Agent | Token Minting |
| Configure supply safeguards | Admin | Token Minting |
| Freeze / unfreeze addresses | Agent | Freeze Management |
| Create new security tokens | Admin | Token Management |
| Create trading markets | Admin | Market Management |
| Configure compliance rules | Admin | Compliance Rules |
| Set jurisdiction whitelist | Admin | Compliance Rules |
| Set concentration caps | Admin | Compliance Rules |
| Set lock-up periods | Admin | Compliance Rules |
| Force-cancel trade orders | Admin | Trading |
| Register custody wallets | Admin | Wallet Custody |
| Add/remove multi-sig signers | Admin | Wallet Custody |
| Mint test ETH | Admin | Mint ETH (Test) |
| Run System Health Check | Admin/Agent | Dashboard |

If you need any of these operations performed, contact the appropriate Admin or Agent.

---

## 14. Dual-Control Rule

The DvP Settlement contract enforces a strict separation of duties:

```
┌─────────────────────────────────────────────────────────┐
│  DUAL-CONTROL RULE                                       │
│                                                          │
│  Creator ≠ Executor                                      │
│                                                          │
│  • Operator A creates a settlement → cannot execute it   │
│  • Operator B (or Admin) must execute                    │
│  • Error if violated: "creator cannot execute own        │
│    settlement"                                           │
│                                                          │
│  Purpose: Prevent single-operator fraud                  │
└─────────────────────────────────────────────────────────┘
```

**In practice:**
- When you create a settlement, the Actions column shows *"Awaiting counterparty"* instead of Execute/Cancel buttons
- Another operator or the Admin must log in to execute your settlement
- This applies to both individual and batch execution

**Workaround for single-operator testing:** The Admin account (which holds OPERATOR_ROLE by default) can execute settlements created by the Operator account, and vice versa.

---

## 15. Troubleshooting

### "Only the counterparty can execute this DvP settlement"

You created this settlement and are trying to execute it — dual-control violation.

**Fix:** Ask another operator or the Admin to execute it. Switch to a different operator account.

### "Seller has not approved sufficient security tokens"

The seller hasn't approved their security tokens to the DvP contract.

**Fix:** The seller must connect their wallet, navigate to DvP Settlement, and click Execute (which auto-approves). Alternatively, the seller can manually approve tokens.

### "Buyer has not approved sufficient cash tokens"

Same as above for the buyer's cash tokens (THKD).

**Fix:** The buyer must connect their wallet and initiate the approval.

### Settlement Shows "Expired"

The settlement passed its deadline without execution.

**Fix:** Click **"Mark Failed"** to finalize. Create a new settlement with a longer deadline.

### "Insufficient warm wallet balance"

The MultiSig warm wallet doesn't have enough tokens for the proposed transfer.

**Fix:** Transfer tokens into the MultiSigWarm contract address first, then retry execution.

### "You have already confirmed this transaction"

Multi-sig requires different signers for each confirmation.

**Fix:** Ask another authorized signer to confirm.

### "This transaction has expired (48-hour limit exceeded)"

Multi-sig warm wallet transactions expire after 48 hours.

**Fix:** Propose a new transaction.

### "KYC Verification Required" on Trading

Your Operator address is not KYC-verified.

**Fix:** Contact an Agent to register your address and issue KYC claims (at minimum topic 1 — KYC Verified).

### Cannot See Admin/Agent Pages

Pages like KYC Management, Token Minting, Freeze Management, Compliance Rules, etc. are restricted to Admin or Agent roles. This is expected behavior for the Operator role.

### Transaction Fails After State Load

The blockchain clock may be behind real time.

**Fix:** Run the clock-fix script (Section 4.3) and retry.

### Wrong Network Warning

A red banner at the top indicates MetaMask is on the wrong chain.

**Fix:** Click **"Switch Network"** or manually configure MetaMask:
- Network Name: Hardhat Devnet
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency: ETH

### Cannot Add/Remove Oracle Members

The Oracle Committee contract restricts management functions to the Admin role. While the Operator can view the committee and access the page, on-chain calls may fail if the contract requires `DEFAULT_ADMIN_ROLE`.

**Fix:** Contact an Admin to make oracle committee changes.
