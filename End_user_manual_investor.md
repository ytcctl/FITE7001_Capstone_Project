# TokenHub — Investor End-User Manual

> HKSTP Security Token Platform · Investor Guide  
> Version 1.0 · April 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [What Is the Investor Role?](#2-what-is-the-investor-role)
3. [Prerequisites](#3-prerequisites)
4. [Getting Started](#4-getting-started)
   - 4.1 [Connect Your Wallet](#41-connect-your-wallet)
   - 4.2 [Check Your KYC Status](#42-check-your-kyc-status)
5. [Navigation — Pages Available to You](#5-navigation--pages-available-to-you)
6. [Dashboard](#6-dashboard)
7. [End-to-End Workflow: Buying Tokens on the Order Book](#7-end-to-end-workflow-buying-tokens-on-the-order-book)
   - 7.1 [Step 1 — Check Your Balances](#71-step-1--check-your-balances)
   - 7.2 [Step 2 — Select a Market](#72-step-2--select-a-market)
   - 7.3 [Step 3 — Review the Order Book](#73-step-3--review-the-order-book)
   - 7.4 [Step 4 — Place a Buy Order](#74-step-4--place-a-buy-order)
   - 7.5 [Step 5 — Track Your Order](#75-step-5--track-your-order)
   - 7.6 [Step 6 — Cancel an Open Order](#76-step-6--cancel-an-open-order)
8. [End-to-End Workflow: Selling Tokens on the Order Book](#8-end-to-end-workflow-selling-tokens-on-the-order-book)
9. [End-to-End Workflow: Participating in DvP Settlement](#9-end-to-end-workflow-participating-in-dvp-settlement)
   - 9.1 [As a Seller](#91-as-a-seller)
   - 9.2 [As a Buyer](#92-as-a-buyer)
   - 9.3 [Viewing Settlement History](#93-viewing-settlement-history)
10. [End-to-End Workflow: Governance Participation](#10-end-to-end-workflow-governance-participation)
    - 10.1 [Step 1 — Delegate Your Voting Power](#101-step-1--delegate-your-voting-power)
    - 10.2 [Step 2 — Vote on Proposals](#102-step-2--vote-on-proposals)
    - 10.3 [Step 3 — Create a Proposal](#103-step-3--create-a-proposal)
    - 10.4 [Proposal Lifecycle](#104-proposal-lifecycle)
11. [End-to-End Workflow: Transferring Tokens](#11-end-to-end-workflow-transferring-tokens)
12. [Page Reference](#12-page-reference)
    - 12.1 [Dashboard](#121-dashboard)
    - 12.2 [Trading](#122-trading)
    - 12.3 [DvP Settlement](#123-dvp-settlement)
    - 12.4 [Governance](#124-governance)
    - 12.5 [Portfolio](#125-portfolio)
    - 12.6 [Cash Token Detail](#126-cash-token-detail)
13. [Compliance Rules That Affect You](#13-compliance-rules-that-affect-you)
14. [Troubleshooting](#14-troubleshooting)

---

## 1. Overview

**TokenHub** is a security token platform for HKSTP (Hong Kong Science & Technology Parks) startup companies. It enables you to:

- **Hold** tokenised equity in HKSTP-approved startups
- **Trade** security tokens on a fully on-chain order book
- **Settle** off-book transactions via atomic delivery-versus-payment (DvP)
- **Vote** on governance proposals that affect token operations
- **Transfer** tokens to other verified investors

All operations are on-chain, meaning every trade, vote, and transfer is recorded immutably on the blockchain.

---

## 2. What Is the Investor Role?

As an investor, you are a KYC-verified participant who can:

| Capability | Description |
|-----------|-------------|
| **View portfolio** | See your token holdings, balances, and identity status |
| **Trade** | Place buy and sell limit orders on listed markets |
| **Settle** | Participate in DvP settlements as a buyer or seller |
| **Vote** | Delegate voting power and vote on governance proposals |
| **Transfer** | Send tokens directly to other verified investors |
| **Propose** | Create governance proposals (if you hold enough tokens) |

### What You Cannot Do

Investor accounts do not have access to administrative functions such as KYC management, token minting/burning, freeze management, compliance configuration, market creation, or token creation. These require Admin, Agent, or Operator roles.

---

## 3. Prerequisites

| Requirement | Details |
|------------|---------|
| **Browser** | Chrome or Firefox |
| **MetaMask** | Installed as a browser extension |
| **Network** | MetaMask configured for Chain ID `31337`, RPC `http://127.0.0.1:8545` |
| **KYC Status** | Your address must be registered and verified by a platform Agent |
| **Tokens** | Security tokens and/or cash tokens (THKD) minted to your address by an Agent |

### Test Investor Accounts

| Label | Address |
|-------|---------|
| investor1 | `0xe8564b67f8a638971ab2A519e786f9ce1182c86f` |
| Seller | `0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef` |
| Buyer | `0x821aEa9a577a9b44299B9c15c88cf3087F3b5544` |

> **Note:** These are well-known test keys. Never use them on a public network.

---

## 4. Getting Started

### 4.1 Connect Your Wallet

1. Open **http://localhost:3000/** in your browser
2. In the sidebar (bottom), click **"Connect Wallet"**
3. Choose a connection method:

   **Option A — Built-in Test Account**
   - Under **"Built-in Test Accounts"**, click **Seller** or **Buyer**

   **Option B — MetaMask**
   - Click **MetaMask** (orange icon)
   - MetaMask pops up — select your account and approve

   **Option C — Custom Private Key**
   - Expand the **"Custom Private Key"** section
   - Enter a label (e.g., `My Wallet`)
   - Paste your private key
   - Click **"Connect & Save"**
   - Your account is saved for quick reconnection next time

4. After connecting, the sidebar shows:
   - Your address: e.g., `0xC5fd…8Fef · Chain 31337`
   - Role badge: **INVESTOR** (blue)

#### Wrong Network Warning

If MetaMask is on a different chain, a red banner appears:

> "Wrong network detected (Chain ID: ?). Please switch to Hardhat Devnet (Chain ID: 31337)."

Click **"Switch Network"** to auto-configure.

---

### 4.2 Check Your KYC Status

After connecting, check the **Dashboard** for your KYC status in the **KYC / AML Claims** card:

| Status | Badge | Meaning |
|--------|-------|---------|
| **Verified ✓** | Green | You can trade, transfer, and vote |
| **Registered** | Amber | Identity registered but not all claims issued yet — contact platform Agent |
| **Not Registered** | Red | Not onboarded — contact platform Agent to begin KYC |

Individual claim topics are shown below the status:

| Topic | Name | Required? |
|-------|------|-----------|
| 1 | KYC Verified | **Yes** (minimum) |
| 2 | Accredited Investor | Recommended |
| 3 | Jurisdiction Approved | Recommended |
| 4 | Source of Funds Verified | Recommended |
| 5 | PEP/Sanctions Clear | Recommended |
| 6 | FPS Name-Match Verified | Optional |

Each topic shows **"Active"** (green) or **"Missing"** (red).

> **If your status is not Verified:** You cannot trade or transfer tokens. Contact the platform Agent to complete your KYC process.

---

## 5. Navigation — Pages Available to You

As an Investor, these sidebar items are visible:

| Sidebar Label | Description |
|--------------|-------------|
| **Dashboard** | Overview of your holdings, KYC status, and market stats |
| **DvP Settlement** | View and participate in delivery-versus-payment settlements |
| **Trading** | Place buy/sell orders on listed markets |
| **Governance** | Vote on proposals and delegate voting power |
| **Portfolio** | Detailed view of all your token holdings and transfers |

Pages you will **not** see: KYC Management, Token Minting, Token Management, Market Management, Compliance Rules, Oracle Committee, Wallet Custody, Freeze Management, Mint ETH (Test).

---

## 6. Dashboard

The Dashboard is your home screen after connecting.

### My Token Holdings

Shows all tokens in your wallet:

- **Security Tokens** (e.g., HKSAT) — balance + last market price
- **Cash Token** (THKD) — balance (click to view the Cash Token detail page)
- **Factory-deployed tokens** — any additional startup tokens you hold

If you have no tokens: *"No token holdings"*

### KYC / AML Claims

Your identity and compliance status. See [Section 4.2](#42-check-your-kyc-status) for details.

### Market Overview

A table of all active markets with columns:

| Column | Description |
|--------|-------------|
| Market | Market name (e.g., HKSAT / HKD) |
| Last Price | Most recent trade price |
| Best Bid | Highest buy order |
| Best Ask | Lowest sell order |
| Trades | Total number of trades |

Click any market to understand pricing before navigating to Trading.

---

## 7. End-to-End Workflow: Buying Tokens on the Order Book

This is the most common investor workflow — purchasing security tokens with cash (THKD).

---

### 7.1 Step 1 — Check Your Balances

**Navigate to:** Sidebar → **Trading**

At the top of the trading page, two balance cards show:

- **{SYMBOL} Balance** — your security token balance (e.g., `10,000.00 HKSAT`)
- **Cash Balance** — your THKD balance (e.g., `$5,000,000.00 HKD`)

> You need sufficient **cash (THKD)** to place buy orders. If your cash balance is zero, contact the platform Agent to have THKD minted to your address.

---

### 7.2 Step 2 — Select a Market

1. At the top of the Trading page, click the **market selector** dropdown
2. A list of active markets appears, each with a green dot indicator
3. Select the market you want to trade (e.g., **HKSAT / HKD**)

The page refreshes with data for the selected market.

---

### 7.3 Step 3 — Review the Order Book

The **Order Book** panel shows current buy and sell orders:

| Section | Color | Description |
|---------|-------|-------------|
| **Sell Orders (Asks)** | Red | Sellers offering tokens — lowest price at the bottom |
| **Spread** | Yellow | Gap between best bid and best ask |
| **Buy Orders (Bids)** | Green | Buyers wanting tokens — highest price at the top |

Each row shows: **Price (HKD)**, **Qty** (quantity), **Total** (price × quantity).

Also check the **Recent Trades** section below the order book for the last 20 executed trades.

---

### 7.4 Step 4 — Place a Buy Order

1. In the **Place Order** section, click the **"Buy"** button (green) to select Buy mode

2. Fill in the order form:

   | Field | What to Enter | Example |
   |-------|--------------|---------|
   | **Price (HKD per {SYMBOL})** | Your limit price — maximum you're willing to pay | `10.50` |
   | **Quantity ({SYMBOL})** | Number of tokens to buy | `500` |

3. Review the **Estimated Total** shown below the form: e.g., *"Estimated Total: $5,250.00 HKD"*

4. Click **"Place Buy Order"**

5. The system:
   - Verifies your KYC status
   - Checks you are not frozen
   - Auto-approves your THKD tokens to the order book contract
   - Submits the order on-chain

6. **Two possible outcomes:**

   **Instant Match:** If your buy price meets or exceeds existing sell orders:
   > "Buy order matched instantly! 2 trade(s) executed. See 'My Orders' and 'My Trade History' below."

   Tokens are transferred immediately. Your token balance increases and cash balance decreases.

   **Resting Order:** If no matching sellers exist at your price:
   > "Buy order placed for HKSAT! Tx: 0x1234ab…"

   Your order sits in the order book (visible in the green buy side) until a seller matches it or you cancel.

> **Price improvement:** When your order matches, it executes at the **maker's price** (the existing order's price), which may be better than your limit price. For example, if you bid 10.50 but the best ask is 10.00, you buy at 10.00.

---

### 7.5 Step 5 — Track Your Order

Scroll down to the **My Orders** section to see all your orders in the current market.

| Column | Description |
|--------|-------------|
| ID | Order number |
| Side | `BUY` (green) or `SELL` (red) |
| Price (HKD) | Your limit price |
| Quantity | Total quantity ordered |
| Filled | Quantity filled so far |
| Status | Current order status (see below) |
| Time | When the order was placed |
| Action | Cancel button (if applicable) |

**Order Statuses:**

| Status | Badge Color | Meaning |
|--------|------------|---------|
| **Open** | Blue | Resting in the order book, awaiting match |
| **Partial** | Yellow | Partially filled — some quantity matched, rest still open |
| **Filled** | Green | Completely filled — all tokens exchanged |
| **Cancelled** | Gray | You cancelled the order |

Check **My Trade History** below for completed trades. Each entry shows:

| Column | Description |
|--------|-------------|
| Trade # | Trade sequence number |
| Role | `BUYER` (green) or `SELLER` (red) |
| Counterparty | The other party's address |
| Price (HKD) | Execution price |
| Quantity | Tokens traded |
| Total (HKD) | Cash exchanged |
| Time | When the trade executed |

---

### 7.6 Step 6 — Cancel an Open Order

If your order hasn't been fully filled and you want to cancel:

1. In the **My Orders** table, find the order with status **Open** or **Partial**
2. Click the red **✕** button in the Action column
3. The order is cancelled on-chain
4. **Locked funds are returned:** your remaining THKD (for buy orders) or security tokens (for sell orders) are refunded automatically

> **Partially filled orders:** If your order was partially filled before cancellation, you keep the tokens/cash from the filled portion. Only the unfilled remainder is refunded.

---

## 8. End-to-End Workflow: Selling Tokens on the Order Book

Selling works the same way as buying, with sides reversed:

1. **Navigate to:** Sidebar → **Trading**
2. Select the market from the dropdown
3. Click the **"Sell"** button (red) to switch to Sell mode
4. Fill in the form:

   | Field | What to Enter | Example |
   |-------|--------------|---------|
   | **Price (HKD per {SYMBOL})** | Your limit price — minimum you're willing to accept | `11.00` |
   | **Quantity ({SYMBOL})** | Number of tokens to sell | `200` |

5. Review the **Estimated Total**: e.g., *"Estimated Total: $2,200.00 HKD"*

6. Click **"Place Sell Order"**

7. The system auto-approves your security tokens to the order book, then submits

8. **Outcomes:**
   - **Instant Match:** If your sell price is at or below existing buy orders, tokens are sold immediately. You receive THKD.
   - **Resting Order:** Your sell order sits in the order book (visible in the red sell side) until a buyer matches or you cancel.

9. Track and cancel in the **My Orders** section, same as buy orders.

---

## 9. End-to-End Workflow: Participating in DvP Settlement

DvP (Delivery-versus-Payment) settlement is used for **off-book** or negotiated trades. It ensures an **atomic swap** — security tokens and cash tokens exchange simultaneously in a single transaction.

**Navigate to:** Sidebar → **DvP Settlement**

---

### 9.1 As a Seller

When you are the **seller** in a settlement:

1. An Operator or counterparty creates the settlement naming you as the seller
2. The settlement appears in the **Settlement History** table with status **Pending** (amber)
3. If the settlement was created by someone else and you are the counterparty:
   - Click **"Execute"** (green button)
   - The system **auto-approves** your security tokens to the DvP contract
   - The atomic swap executes: your security tokens transfer to the buyer, and cash (THKD) transfers to you
4. Success message: **"✓ Settlement #{id} executed — DvP atomic swap complete"**
5. Status changes to **Settled** (green)

> **If you created the settlement yourself:** You see *"Awaiting counterparty"* and cannot execute it. The other party (or an Operator) must execute.

---

### 9.2 As a Buyer

When you are the **buyer** in a settlement:

1. The settlement appears in the **Settlement History** with status **Pending**
2. If the settlement was created by someone else and you are the counterparty:
   - Click **"Execute"** (green button)
   - The system **auto-approves** your cash tokens (THKD) to the DvP contract
   - The atomic swap executes: cash transfers to the seller, and security tokens transfer to you
3. Status changes to **Settled** (green)

---

### 9.3 Viewing Settlement History

The settlement table shows all settlements:

| Column | Description |
|--------|-------------|
| ID | Settlement number |
| Seller | Seller's address |
| Buyer | Buyer's address |
| Security Token | Token being sold |
| Amount | Number of tokens |
| Cash Token | Payment token (THKD) |
| Cash Amt | Cash amount |
| Status | Current status |
| Created By | Who created the settlement |
| Actions | Execute, Cancel, or Mark Failed |

**Status Badges:**

| Status | Color | Meaning |
|--------|-------|---------|
| **Pending** | Amber | Awaiting execution — you may be able to act |
| **Settled** | Green | Completed successfully |
| **Failed** | Red | Pre-flight compliance check failed |
| **Cancelled** | Gray | Cancelled by a party or operator |
| **Expired** | Orange | Passed the deadline without execution |

**Actions available to you:**
- **"Execute"** (green) — if you are the counterparty (not the creator)
- **"Cancel"** (red) — cancel a pending settlement
- **"Mark Failed"** (orange) — clean up an expired settlement

---

## 10. End-to-End Workflow: Governance Participation

TokenHub uses on-chain governance for critical decisions such as large token mints. As a token holder, you can vote on proposals and even create your own.

**Navigate to:** Sidebar → **Governance**

---

### 10.1 Step 1 — Delegate Your Voting Power

**Before you can vote, you must delegate your voting power — even to yourself.**

1. Select your token from the **Token Selector** dropdown at the top
2. Check the **Your Voting Power** card:
   - **Token Balance** — how many tokens you hold
   - **Voting Power** — your active votes (may be 0 if not delegated)
   - **Delegated To** — who your votes are assigned to

3. If you see the warning: *"You must self-delegate to activate voting power!"*:
   - In the **Delegate Votes** card, click the **"Self"** button to fill in your own address
   - Click **"Delegate"**
   - Your voting power activates and equals your token balance

> **Why delegate?** ERC-20 governance tokens require explicit delegation. Without it, your tokens exist but carry zero voting weight. You can also delegate to someone else's address to let them vote on your behalf.

---

### 10.2 Step 2 — Vote on Proposals

1. Scroll down to the **Proposals** list
2. Find a proposal with state **Active** (blue badge)
3. Review the proposal:
   - Read the description
   - Check the current vote tallies: **For** (green bar), **Against** (red bar), **Abstain** (gray bar)
   - Expand for details: Proposer, Voting Start, Voting End, Target actions
4. Cast your vote by clicking one of three buttons:
   - **"For"** — vote in favour
   - **"Against"** — vote against
   - **"Abstain"** — abstain (counts toward quorum but not for/against)
5. Confirm the wallet transaction
6. After voting, the button area shows: *"You have already voted"*

### Important Voting Rules

- You can only vote **once** per proposal
- Your voting weight is based on your token balance **at the time the proposal was created** (the snapshot block)
- If you delegated **after** the proposal was created, your vote is recorded but with **zero weight**
- Proposals need to reach a **quorum** (typically 10% of total supply) to pass

---

### 10.3 Step 3 — Create a Proposal

If you hold enough tokens (≥ the proposal threshold, typically **10,000 tokens**):

1. In the **Create Proposal** section, select the proposal type:
   - **Signaling** — a text-only, non-binding vote (available to all qualifying investors)
   - **Executable Action** — executes an on-chain action after passing (admin/agent only)

2. Enter a **Description** in the textarea explaining what you're proposing

3. Click **"Submit Proposal"**

4. Your proposal enters the **Pending** state and moves to **Active** after the voting delay (typically 48 hours)

> **If you don't have enough tokens:** An error appears: *"Insufficient voting power to propose. You have X votes but need at least Y."*

---

### 10.4 Proposal Lifecycle

| State | Badge | What Happens | Your Action |
|-------|-------|-------------|-------------|
| **Pending** | Amber | Waiting for voting delay to pass | Wait |
| **Active** | Blue | Voting is open | Cast your vote |
| **Defeated** | Red | Vote failed (quorum not reached or more Against) | — |
| **Succeeded** | Green | Vote passed | Click **"Queue for Execution"** |
| **Queued** | Purple | In Timelock waiting period (48h) | Wait |
| **Executed** | Cyan | Action has been completed | — |
| **Canceled** | Gray | Cancelled by proposer or admin | — |
| **Expired** | Gray | Queued but not executed in time | — |

**Governor Configuration** (displayed at the top of the page):

| Parameter | Typical Value |
|-----------|--------------|
| Voting Delay | 48 hours |
| Voting Period | 7 days |
| Quorum | 10% of total supply |
| Proposal Threshold | 10,000 tokens |
| Timelock Delay | 48 hours |

---

## 11. End-to-End Workflow: Transferring Tokens

You can send tokens directly to another verified investor.

**Navigate to:** Sidebar → **Portfolio**

1. Scroll to the **Transfer Tokens** section

2. Fill in the form:

   | Field | What to Enter | Example |
   |-------|--------------|---------|
   | **Token Type** | Select from dropdown | `HKSAT (Security)` or `THKD (Cash)` |
   | **Recipient Address** | The recipient's Ethereum address | `0x821aEa9a577a9b44299B9c15c88cf3087F3b5544` |
   | **Amount** | Number of tokens to send | `1000` |

3. Click **"Transfer"**

4. The system performs compliance checks:
   - Your address is not frozen
   - The recipient address is not frozen
   - The recipient is KYC-verified (or safe-listed)
   - The transfer does not violate concentration caps, jurisdiction rules, or lock-up periods

5. Success message: **"✓ Transferred 1,000 HKSAT to 0x821a…5544"**

### Transfer Error Messages

| Error | Meaning |
|-------|---------|
| *"Your address is frozen"* | Your account has been frozen by compliance — contact the Agent |
| *"Recipient address is frozen"* | The recipient is frozen — they must resolve with the Agent |
| *"Recipient is not KYC-verified"* | The recipient hasn't completed KYC — only verified investors can receive tokens |
| *"Shareholder cap exceeded (Cap. 622)"* | The transfer would create a new shareholder beyond the legal limit |

---

## 12. Page Reference

### 12.1 Dashboard

**Path:** `/`

| Section | What It Shows |
|---------|---------------|
| **My Token Holdings** | All your token balances with last market prices |
| **KYC / AML Claims** | Your verification status and individual claim topics |
| **Market Overview** | Top 10 active markets by trade volume |

---

### 12.2 Trading

**Path:** `/trading`

| Section | Purpose |
|---------|---------|
| **Market Selector** | Choose which token market to trade |
| **Market Overview Cards** | Last Price, 24h Change, Best Bid, Best Ask, Spread, Total Orders, Total Trades |
| **Balances** | Your security token and cash balances |
| **Place Order** | Buy/Sell toggle, price, quantity, estimated total |
| **Order Book** | Live buy (green) and sell (red) orders |
| **Recent Trades** | Last 20 executed trades |
| **My Orders** | Your open, partial, filled, and cancelled orders with cancel button |
| **My Trade History** | Your completed trades with role (Buyer/Seller), counterparty, and totals |

---

### 12.3 DvP Settlement

**Path:** `/settlement`

| Section | Purpose |
|---------|---------|
| **Create Settlement** | Create a new DvP instruction (Seller, Buyer, Token, Amounts, Deadline) |
| **Batch Execute Bar** | Select and batch-execute multiple pending settlements |
| **Settlement History** | View all settlements with Execute, Cancel, and Mark Failed actions |

---

### 12.4 Governance

**Path:** `/governance`

| Section | Purpose |
|---------|---------|
| **Token Selector** | Choose which token's governance to interact with |
| **Governor Config** | Voting delay, period, quorum, threshold, timelock delay |
| **Your Voting Power** | Balance, active votes, delegatee |
| **Delegate Votes** | Self-delegate or delegate to another address |
| **Create Proposal** | Submit signaling proposals (if threshold met) |
| **Proposals List** | View, vote, queue, and execute proposals |

---

### 12.5 Portfolio

**Path:** `/portfolio`

| Section | Purpose |
|---------|---------|
| **Holdings Grid** | Large balance cards for security tokens, cash, and factory tokens |
| **Identity & Compliance** | Registered/Verified/Frozen status, country, per-topic claim status |
| **Transfer Tokens** | Send tokens to another verified investor |

---

### 12.6 Cash Token Detail

**Path:** `/cash-token` (accessible by clicking THKD on Dashboard or Portfolio)

| Section | Purpose |
|---------|---------|
| **Token Info** | Symbol (THKD), Decimals (6), Total Supply, Your Balance |
| **Contract Owner** | Address of the token owner |
| **Known Holders** | Table of all holders with balance and % of supply (your address highlighted) |
| **Recent Transfers** | Last 20 token transfers with From, To, Amount, Block |

---

## 13. Compliance Rules That Affect You

The platform enforces several compliance rules that may affect your transactions. These rules are set by the Admin and enforced automatically on-chain.

### Freeze

If your address is **frozen** by the compliance administrator:
- You **cannot** send or receive any security token
- You **cannot** place orders on the trading page
- You **cannot** participate in DvP settlements
- Contact the platform Agent to resolve the issue

### KYC Verification

You must be **registered** and **verified** (with all required claims issued) to:
- Receive security tokens
- Place buy or sell orders
- Be a counterparty in DvP settlements

### Jurisdiction Restrictions

The compliance module maintains a whitelist of allowed jurisdictions. If your registered country is blocked, token transfers to/from your address will fail.

### Concentration Cap

A maximum percentage of a token's supply that any single investor can hold. If a transfer or trade would push your holdings above this cap, the transaction is rejected.

### Lock-Up Period

The Admin may set a lock-up period on your tokens. During the lock-up:
- You **cannot** transfer or sell the locked tokens
- You **can** still buy additional tokens and vote in governance
- Lock-ups expire automatically at the configured end date

### Shareholder Cap (Cap. 622)

Under Hong Kong Companies Ordinance Cap. 622, private companies are limited to 50 shareholders. The platform tracks unique shareholders by on-chain identity (not wallet count), so holding tokens across multiple wallets linked to the same identity counts as one shareholder.

If a transfer would create a new shareholder beyond the cap, it is rejected with: *"shareholder cap exceeded (Cap. 622)"*

---

## 14. Troubleshooting

### "KYC Verification Required" Banner on Trading

Your address is not verified for trading.

**What to do:**
1. Go to **Dashboard** and check your KYC / AML Claims card
2. If status is **Not Registered** — contact the platform Agent to start your KYC process
3. If status is **Registered** but not **Verified** — contact the Agent to issue the remaining claims (at minimum, Topic 1: KYC Verified)

### "Your wallet is frozen by the compliance administrator"

Your address has been frozen, blocking all token operations.

**What to do:** Contact the platform Agent. A freeze typically indicates a compliance issue (expired KYC, sanctions match, AML alert) that must be resolved before trading can resume.

### Order Placed But Not Filled

Your limit order is resting in the order book with no matching counterparty.

**Options:**
- **Wait** for a counterparty to place a matching order
- **Cancel** the order and place a new one at a more competitive price
- Check the **Order Book** panel to see current bid/ask levels

### "Insufficient token balance" or "Insufficient allowance"

You don't have enough tokens (or token approval) for the operation.

**What to do:**
- For **buying**: Ensure you have sufficient THKD cash balance
- For **selling**: Ensure you have sufficient security token balance
- The platform auto-approves tokens before submitting orders, but if approval fails, retry the operation

### "Recipient is not KYC-verified" on Transfer

The address you're sending tokens to hasn't completed KYC.

**What to do:** The recipient must contact the platform Agent to complete KYC before they can receive security tokens.

### "Shareholder cap exceeded (Cap. 622)" on Transfer

The transfer would create a new shareholder beyond the legal limit (typically 50).

**What to do:** Contact the platform Admin. The cap can be adjusted if the company's legal structure allows it.

### Cannot Vote on a Proposal

**Possible causes:**
1. **Not delegated:** You must self-delegate first. Go to Governance → Delegate Votes → click **"Self"** → click **"Delegate"**
2. **Already voted:** You can only vote once per proposal. The UI shows *"You have already voted"*
3. **Delegated after proposal:** If you delegated after the proposal was created, your vote has zero weight. Your delegation applies to future proposals.
4. **Zero balance at snapshot:** Your voting weight is based on your token balance when the proposal was created, not your current balance

### "Insufficient voting power to propose"

You don't hold enough tokens to create a proposal (typically 10,000 tokens required).

**What to do:** Acquire more tokens through trading, or ask another token holder with sufficient balance to create the proposal on your behalf.

### Settlement Shows "Awaiting counterparty"

You created this settlement and cannot execute it yourself (dual-control rule).

**What to do:** The other party or an Operator must execute the settlement. Contact the counterparty or an Operator.

### Settlement Shows "Expired"

The settlement passed its deadline without execution.

**What to do:** Click **"Mark Failed"** to finalize it, then coordinate with the counterparty to create a new settlement with a longer deadline.

### Wrong Network Warning

A red banner shows MetaMask is on the wrong chain.

**Fix:** Click **"Switch Network"** or manually configure MetaMask:
- Network Name: Hardhat Devnet
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency: ETH

### Transactions Failing After Page Load

The blockchain clock may be behind real time (common after loading a state snapshot).

**What to do:** Ask the platform admin to run the clock-fix script, or wait for the admin to advance the blockchain time.
