# TokenHub — Agent End-User Manual

> HKSTP Security Token Platform · Agent / Custodian Guide  
> Version 1.0 · April 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [What Is the Agent Role?](#2-what-is-the-agent-role)
3. [System Prerequisites](#3-system-prerequisites)
4. [Starting the Platform](#4-starting-the-platform)
5. [Connecting as Agent](#5-connecting-as-agent)
6. [Navigation — Pages Available to You](#6-navigation--pages-available-to-you)
7. [Dashboard](#7-dashboard)
8. [End-to-End Workflow: Onboarding an Investor Through to First Trade](#8-end-to-end-workflow-onboarding-an-investor-through-to-first-trade)
   - 8.1 [Step 1 — Register the Investor's Identity (KYC)](#81-step-1--register-the-investors-identity-kyc)
   - 8.2 [Step 2 — Issue KYC / AML Claims](#82-step-2--issue-kyc--aml-claims)
   - 8.3 [Step 3 — Verify Registration](#83-step-3--verify-registration)
   - 8.4 [Step 4 — Mint Security Tokens to the Investor](#84-step-4--mint-security-tokens-to-the-investor)
   - 8.5 [Step 5 — Mint Cash Tokens (THKD) to the Investor](#85-step-5--mint-cash-tokens-thkd-to-the-investor)
   - 8.6 [Step 6 — Investor Is Ready to Trade](#86-step-6--investor-is-ready-to-trade)
9. [End-to-End Workflow: Compliance Enforcement](#9-end-to-end-workflow-compliance-enforcement)
   - 9.1 [Freeze a Non-Compliant Address](#91-freeze-a-non-compliant-address)
   - 9.2 [Scan and Cancel Outstanding Activity](#92-scan-and-cancel-outstanding-activity)
   - 9.3 [Revoke Claims or Delete Identity](#93-revoke-claims-or-delete-identity)
   - 9.4 [Unfreeze After Remediation](#94-unfreeze-after-remediation)
10. [End-to-End Workflow: Token Supply Operations](#10-end-to-end-workflow-token-supply-operations)
    - 10.1 [Minting Tokens](#101-minting-tokens)
    - 10.2 [Burning Tokens](#102-burning-tokens)
    - 10.3 [Understanding Supply Safeguards](#103-understanding-supply-safeguards)
11. [Page Reference](#11-page-reference)
    - 11.1 [KYC Management](#111-kyc-management)
    - 11.2 [Token Minting](#112-token-minting)
    - 11.3 [Freeze Management](#113-freeze-management)
    - 11.4 [Oracle Committee](#114-oracle-committee)
    - 11.5 [Wallet Custody](#115-wallet-custody)
    - 11.6 [Governance](#116-governance)
    - 11.7 [DvP Settlement](#117-dvp-settlement)
    - 11.8 [Trading](#118-trading)
    - 11.9 [Portfolio](#119-portfolio)
12. [What You Cannot Do (Admin-Only)](#12-what-you-cannot-do-admin-only)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Overview

**TokenHub** is an end-to-end security token issuance, trading, and settlement platform for HKSTP (Hong Kong Science & Technology Parks) startup companies. The platform runs on an EVM blockchain and provides on-chain identity management, compliance enforcement, order-book trading, delivery-versus-payment settlement, and governance.

This manual is written for the **Agent** role — the day-to-day operations staff responsible for investor onboarding, token minting/burning, and compliance enforcement.

---

## 2. What Is the Agent Role?

The Agent (also referred to as **Custodian** in some contexts) is a privileged staff role that handles:

| Responsibility | Description |
|---------------|-------------|
| **Investor Onboarding** | Register investor identities and issue KYC/AML claims |
| **Token Minting** | Mint security tokens and cash tokens to verified investors (within the governance threshold) |
| **Token Burning** | Burn tokens from investor addresses |
| **Freeze / Unfreeze** | Emergency freeze of non-compliant investor addresses |
| **Safe-Listing** | Mark contract addresses as compliance-exempt |
| **Compliance Force Cancel** | Scan non-compliant investors and cancel their outstanding orders, settlements, and proposals |

### What the Agent Role Does NOT Have Access To

The Agent cannot create tokens, create markets, configure compliance rules, manage jurisdiction whitelists, set concentration caps, or perform other admin-level configuration. See [Section 12](#12-what-you-cannot-do-admin-only) for the full list.

---

## 3. System Prerequisites

| Component | Requirement |
|-----------|-------------|
| **Browser** | Chrome or Firefox with MetaMask extension |
| **MetaMask** | Network configured for Chain ID `31337`, RPC `http://127.0.0.1:8545` |
| **Platform** | TokenHub frontend running at `http://localhost:3000/` (or tunnel URL) |
| **Blockchain** | Anvil node running with contracts deployed |

### Default Agent Account

| Field | Value |
|-------|-------|
| Label | Agent / Custodian |
| Address | `0xf17f52151EbEF6C7334FAD080c5704D77216b732` |
| Private Key | `0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f` |
| Roles | `AGENT_ROLE` |

> **Note:** This is a well-known Hardhat/Besu test key. Never use it on a public network.

---

## 4. Starting the Platform

> If the platform is already running (started by an admin or DevOps), skip to [Section 5](#5-connecting-as-agent).

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

## 5. Connecting as Agent

1. Open **http://localhost:3000/** in your browser
2. In the sidebar (bottom), click **"Connect Wallet"**
3. A dropdown appears with connection options. Choose one:

   **Option A — Built-in Test Account (Recommended for Development)**
   - Under the **"Built-in Test Accounts"** section, click **Agent / Custodian**
   - This connects with address `0xf17f52151EbEF6C7334FAD080c5704D77216b732`

   **Option B — MetaMask**
   - Click **MetaMask** (orange icon)
   - MetaMask pops up — select or import the Agent account
   - Approve the connection

   **Option C — Custom Private Key**
   - Expand the **"Custom Private Key"** section
   - Enter a label (e.g., `Agent`)
   - Paste the Agent private key
   - Click **"Connect & Save"**

4. After connecting, the sidebar shows:
   - `Connected (Built-in)` or `Connected (MetaMask)`
   - Address: `0xf17f…b732 · Chain 31337`
   - Role badge: **AGENT** (orange)

### Wrong Network Warning

If your browser wallet is on a different network, a red banner appears at the top:

> "Wrong network detected (Chain ID: ?). Please switch to Hardhat Devnet (Chain ID: 31337)."

Click **"Switch Network"** to auto-configure (MetaMask only).

---

## 6. Navigation — Pages Available to You

As an Agent, these sidebar items are visible:

| Sidebar Label | Badge | Description |
|--------------|-------|-------------|
| **Dashboard** | — | Overview, balances, KYC status, market stats |
| **KYC Management** | `Staff` | Register investors, issue claims, lookup status, force-cancel |
| **Token Minting** | `Staff` | Mint and burn security tokens and cash tokens |
| **DvP Settlement** | — | View settlement history (creation requires Operator role) |
| **Trading** | — | View markets and place orders |
| **Oracle Committee** | `Privileged` | View and manage oracle members |
| **Wallet Custody** | `Privileged` | View custody wallets, propose/confirm multi-sig transfers |
| **Freeze Management** | `Staff` | Freeze and unfreeze investor addresses |
| **Governance** | — | View and vote on governance proposals |
| **Portfolio** | — | View your own token holdings |

Pages you will **not** see (Admin-only): Token Management, Market Management, Compliance Rules, Mint ETH (Test).

---

## 7. Dashboard

After connecting, the Dashboard shows:

### My Token Holdings
- Your security token balance (e.g., HKSAT) with last market price
- Your cash token balance (Tokenized HKD / THKD)
- Balances for any factory-deployed tokens

### KYC / AML Claims
- Your own KYC status and claim topics (1–6):

| Topic | Description |
|-------|-------------|
| 1 | KYC Verified |
| 2 | Accredited Investor |
| 3 | Jurisdiction Approved |
| 4 | Source of Funds |
| 5 | PEP/Sanctions Clear |
| 6 | FPS Name-Match |

### Market Overview
Table of active order-book markets with: **Market**, **Last Price**, **Best Bid**, **Best Ask**, **Trades**.

### System Health (Staff-visible)
- Status badge: **"● Healthy"** or **"● Issues Detected"**
- Click **"Run Health Check"** to verify all on-chain contracts
- Shows pass/fail results with detail text for each contract check

---

## 8. End-to-End Workflow: Onboarding an Investor Through to First Trade

This is the primary Agent workflow — taking a new investor from zero to trading-ready.

---

### 8.1 Step 1 — Register the Investor's Identity (KYC)

**Navigate to:** Sidebar → **KYC Management**

1. In the **Register Identity** section:

   | Field | What to Enter |
   |-------|--------------|
   | **Investor Address** | The investor's Ethereum address (e.g., `0x1234…abcd`) |
   | **Country Code** | Select from dropdown (e.g., `HK` for Hong Kong) |
   | **Registration Mode** | Choose one: |

   - **ONCHAINID** — Deploys a dedicated ERC-735 identity contract for the investor. This is the production-grade option that supports cryptographically signed claims.
   - **Boolean** — Simple flag-based registration. Faster, suitable for testing or minimal compliance setups.

2. Click **"Register Identity"**

3. Confirm the wallet transaction

4. Success message confirms registration

> **Tip:** Use ONCHAINID mode for real investors who need verifiable claims. Use Boolean mode for quick test setups.

---

### 8.2 Step 2 — Issue KYC / AML Claims

Still on the **KYC Management** page, scroll to the **Issue Claims** section.

1. Choose the claim mode:
   - **Signed Claim (ONCHAINID)** — for ONCHAINID-registered investors
   - **Boolean Claim** — for Boolean-registered investors

2. Fill in the form:

   | Field | What to Enter |
   |-------|--------------|
   | **Investor Address** | Same address registered in Step 1 |
   | **Claim Topic** | Select the claim to issue (see table below) |

3. For **Signed Claims**: set **Action** to **Issue**
4. For **Boolean Claims**: set **Value** to **true**
5. Click **"Issue Signed Claim"** or **"Set Boolean Claim"**
6. Repeat for each required claim topic

#### Claim Topics to Issue

| Topic | Name | Required? | Description |
|-------|------|-----------|-------------|
| 1 | KYC Verified | **Yes** (minimum) | Basic identity verification |
| 2 | Accredited Investor | Recommended | Meets accredited investor criteria |
| 3 | Jurisdiction Approved | Recommended | Investor's jurisdiction is whitelisted |
| 4 | Source of Funds | Recommended | Source of funds verified |
| 5 | PEP/Sanctions Clear | Recommended | Not a politically exposed person, not sanctioned |
| 6 | FPS Name-Match | Optional | FPS (Faster Payment System) name match verified |

> **Minimum for trading:** Topic 1 (KYC Verified) must be issued for the investor to be marked as **Verified** and permitted to receive tokens and trade.

---

### 8.3 Step 3 — Verify Registration

Still on the **KYC Management** page, scroll to the **Lookup Investor** section.

1. Enter the investor's **Address**
2. Click **"Lookup"**
3. Confirm the following:

   | Check | Expected |
   |-------|----------|
   | Registration Status | ✓ Registered |
   | Verified Status | ✓ Verified |
   | Country | Correct country code (e.g., HK) |
   | Identity Contract | Address shown (for ONCHAINID mode) |
   | Claim 1 — KYC Verified | ✓ Active |
   | Other claims | Active for each topic you issued |

If anything is missing, go back and issue the missing claim.

---

### 8.4 Step 4 — Mint Security Tokens to the Investor

**Navigate to:** Sidebar → **Token Minting**

1. Use the **Token Selector** dropdown at the top to choose the correct security token (e.g., HKSAT)

2. In the **Mint Security Token** section:

   | Field | What to Enter |
   |-------|--------------|
   | **Recipient Address** | The investor's address (must be registered AND verified) |
   | **Amount** | Number of tokens (e.g., `10000`) |

3. Click **"Mint {SYMBOL}"** (e.g., "Mint HKSAT")

4. Confirm the wallet transaction

> **Pre-flight check:** The system validates that the recipient is registered AND verified in the Identity Registry before allowing the mint. If the recipient is not registered or not verified, a specific error message will appear. Go back to KYC Management to fix.

> **Supply safeguard:** If the amount exceeds the governance mint threshold (shown in the Supply Safeguards banner), the transaction will be rejected. Mints above the threshold require a governance proposal. Contact an Admin to initiate one, or reduce the mint amount below the threshold.

---

### 8.5 Step 5 — Mint Cash Tokens (THKD) to the Investor

Still on the **Token Minting** page:

1. Scroll to the **Mint Cash Token (THKD)** section

   | Field | What to Enter |
   |-------|--------------|
   | **Recipient Address** | The investor's address |
   | **Amount** | Cash amount in THKD (e.g., `5000000` for HKD 5,000,000) |

2. Click **"Mint THKD"**

3. Confirm the wallet transaction

> **Note:** THKD has 6 decimals (like USDC). An amount of `5000000` represents 5,000,000.00 THKD.

---

### 8.6 Step 6 — Investor Is Ready to Trade

The investor now has:
- ✓ Registered identity
- ✓ KYC claims issued and verified
- ✓ Security tokens in their wallet
- ✓ Cash tokens (THKD) for buying

The investor can:
- Go to **Trading** → select a market → place Buy and Sell orders
- Participate in **DvP Settlement** as a buyer or seller
- Delegate voting power and participate in **Governance**
- View their holdings in **Portfolio**

---

## 9. End-to-End Workflow: Compliance Enforcement

When an investor fails compliance checks (e.g., expired KYC, sanctions match, AML alert), the Agent must act swiftly to freeze the address and cancel outstanding activity.

---

### 9.1 Freeze a Non-Compliant Address

**Navigate to:** Sidebar → **Freeze Management**

1. Enter the **Wallet Address** of the non-compliant investor
2. Click **"Freeze"** (red button)
3. Confirm the wallet transaction

> **Effect:** The freeze applies across ALL security tokens simultaneously — the default token plus every factory-deployed token (V1 and V2). The frozen address cannot send or receive any security token.

#### Verify the Freeze

1. In the **Check Frozen Status** section, enter the address
2. Click **"Lookup"**
3. The display shows a per-token freeze breakdown confirming the address is frozen on each token

---

### 9.2 Scan and Cancel Outstanding Activity

**Navigate to:** Sidebar → **KYC Management**

Scroll to the **Compliance Force Cancel** section:

1. Enter the **Investor Address**
2. Click **"Scan"**

The system searches for all outstanding activity involving this address:

| Activity Type | What's Shown | Action Button |
|--------------|-------------|---------------|
| **Open Trade Orders** | Order ID, market, side, price, quantity | **"Cancel Order"** |
| **Pending Governance Proposals** | Proposal ID, description | **"Cancel Proposal"** |
| **Pending DvP Settlements** | Settlement ID, counterparty, amounts | **"Cancel Settlement"** |

3. Click each **"Cancel…"** button to cancel the respective item
4. Confirm each wallet transaction

#### Review the Audit Trail

Expand the **Audit Trail** section (collapsible) to see the investor's full history:
- Transfer history with block numbers and timestamps
- Completed orders
- Completed settlements
- Completed governance proposals

This provides evidence for compliance records.

---

### 9.3 Revoke Claims or Delete Identity

If the investor's KYC status must be formally revoked:

1. In the **Issue Claims** section, select **Signed Claim (ONCHAINID)** mode
2. Enter the investor's address
3. Select the claim topic to revoke (e.g., Topic 1 — KYC Verified)
4. Set **Action** to **Revoke**
5. Click **"Issue Signed Claim"**

For Boolean claims, set **Value** to **false** and click **"Set Boolean Claim"**.

> After revoking claim topic 1, the investor's status changes from **Verified** to **Registered** (not verified). They can no longer receive tokens or place new orders, even if not frozen.

---

### 9.4 Unfreeze After Remediation

Once the compliance issue is resolved:

**Navigate to:** Sidebar → **Freeze Management**

1. Enter the **Wallet Address**
2. Click **"Unfreeze"** (green button)
3. Confirm the wallet transaction

The address is unfrozen on all tokens. If claims were revoked, re-issue them via KYC Management before the investor can trade again.

---

## 10. End-to-End Workflow: Token Supply Operations

### 10.1 Minting Tokens

**Navigate to:** Sidebar → **Token Minting**

#### Mint Security Tokens

1. Select the token from the **Token Selector** dropdown
2. Enter the **Recipient Address** (must be KYC-verified)
3. Enter the **Amount**
4. Click **"Mint {SYMBOL}"**

#### Mint Cash Tokens (THKD)

1. Enter the **Recipient Address**
2. Enter the **Amount**
3. Click **"Mint THKD"**

#### Supply Information

The page displays supply info cards:
- **Token name, symbol, total supply**
- **Supply cap usage bar** — color-coded:
  - 🟢 Green: < 75% of max supply
  - 🟡 Yellow: 75–90% of max supply
  - 🔴 Red: > 90% of max supply

If supply safeguards are active, a banner shows:
- **Max Supply** — absolute cap on total supply
- **Governance Threshold** — mints above this require a governance proposal

---

### 10.2 Burning Tokens

#### Burn Security Tokens

1. In the **Burn Security Token** section:
   - Enter the **From Address** (the address to burn from)
   - Enter the **Amount**
2. Click **"Burn {SYMBOL}"**

#### Burn Cash Tokens

1. In the **Burn Cash Token** section:
   - Enter the **From Address**
   - Enter the **Amount**
2. Click **"Burn THKD"**

> **Use case:** Burning is typically used for token redemptions (investor exits), correcting erroneous mints, or reducing supply for corporate actions.

---

### 10.3 Understanding Supply Safeguards

The Supply Safeguard Configuration section is visible on the Token Minting page but displays a **"Read-only"** badge for Agent accounts. Only Admins can change these values.

| Safeguard | What It Does | Agent Impact |
|-----------|-------------|-------------|
| **Max Supply** | Absolute ceiling on total token supply | You cannot mint beyond this cap |
| **Mint Threshold** | Mints above this require governance (Timelock) | You can only mint amounts ≤ threshold directly |

If you attempt a mint that exceeds the threshold, the transaction will fail. In this case:
1. Reduce the mint amount to below the threshold, OR
2. Ask an Admin to create a governance proposal for a large mint via the Timelock

---

## 11. Page Reference

### 11.1 KYC Management

**Path:** `/kyc` · **Access:** Agent + Admin

| Section | Purpose | Key Actions |
|---------|---------|-------------|
| **Register Identity** | Onboard new investors | Enter address + country + mode → "Register Identity" |
| **Issue Claims** | Issue or revoke KYC/AML claims | Select topic + action → "Issue Signed Claim" or "Set Boolean Claim" |
| **Lookup Investor** | Query any investor's status | Enter address → "Lookup" |
| **Compliance Force Cancel** | Cancel outstanding activity for non-compliant investors | Enter address → "Scan" → cancel individual items |
| **Audit Trail** | View investor history | Collapsible section under Force Cancel results |

---

### 11.2 Token Minting

**Path:** `/mint` · **Access:** Agent + Admin

| Section | Fields | Action Button |
|---------|--------|--------------|
| **Mint Security Token** | Recipient Address, Amount | "Mint {SYMBOL}" |
| **Burn Security Token** | From Address, Amount | "Burn {SYMBOL}" |
| **Mint Cash Token (THKD)** | Recipient Address, Amount | "Mint THKD" |
| **Burn Cash Token** | From Address, Amount | "Burn THKD" |
| **Supply Safeguard Configuration** | (Read-only for Agent) | — |

---

### 11.3 Freeze Management

**Path:** `/freeze` · **Access:** Agent + Admin

| Section | Fields | Action Buttons |
|---------|--------|---------------|
| **Freeze / Unfreeze Address** | Wallet Address | **"Freeze"** (red), **"Unfreeze"** (green) |
| **Check Frozen Status** | Address | **"Lookup"** → per-token freeze status |

---

### 11.4 Oracle Committee

**Path:** `/oracle` · **Access:** Agent + Admin + Operator

View and manage the multi-oracle compliance attestation committee.

| Element | Description |
|---------|-------------|
| **Summary Cards** | Oracle Members count, Signature Threshold (N-of-M), Security Level |
| **Oracle Members List** | Each member's address with "YOU" badge if your address |
| **Add Oracle** | Enter address → "Add Oracle" |
| **Set Threshold** | Enter value → "Update Threshold" |
| **Remove** | Trash icon per member (disabled if removal would drop below threshold) |

---

### 11.5 Wallet Custody

**Path:** `/custody` · **Access:** Agent + Admin + Operator

Multi-tier custody wallet system with multi-signature warm wallet.

#### Wallet Tiers

| Tier | Label | Purpose |
|------|-------|---------|
| Hot (1) | 🔥 Hot | Day-to-day operations, subject to a cap |
| Warm (2) | 🌡 Warm | Multi-sig controlled operational transfers |
| Cold (3) | ❄ Cold | Long-term storage |

#### Key Sections

| Section | Purpose |
|---------|---------|
| **Tier Breakdown** | Per-token balances across tiers, total AUM, hot cap alerts |
| **Register Wallet** | Register new wallets: address + tier + label |
| **Registered Wallets** | View all wallets with deactivate/reactivate |
| **MultiSig Warm Wallet** | Propose, confirm, execute multi-sig transfers |

#### MultiSig Warm Wallet — Agent Workflow

If you are a signer on the warm wallet:

1. **Propose a transfer:**
   - Select **Token**, enter **To Address**, **Amount**, and **Reason** (sweep-to-cold / operational / rebalance)
   - Click **"Propose"**

2. **Confirm another signer's proposal:**
   - Find the pending transaction in the table
   - Click **"Confirm"**

3. **Execute** (when enough confirmations are collected):
   - Click **"Execute"**

4. **Revoke your confirmation** or **Cancel** a proposal if needed

---

### 11.6 Governance

**Path:** `/governance` · **Access:** All users

As an Agent, you can participate in governance:

- **Delegate voting power:** Enter your own address → click **"Delegate"** to self-delegate (activates your votes)
- **Create proposals:** If you hold enough tokens (≥ proposal threshold, typically 10,000)
  - Select type: **Signaling** (text-only) or **Executable** (on-chain action)
  - For executable: select action (e.g., `mint`), enter parameters
  - Enter description → click **"Submit Proposal"**
- **Vote on proposals:** Click **For**, **Against**, or **Abstain** during the voting period
- **Queue / Execute** passed proposals

---

### 11.7 DvP Settlement

**Path:** `/settlement` · **Access:** All users (creation requires Operator role)

As an Agent, you can:
- **View** settlement history with status badges (Pending / Settled / Failed / Cancelled / Expired)
- **Execute** a pending settlement if you are one of the parties (auto-approves required tokens)
- **Cancel** a settlement you created or are party to

> **Note:** Creating new settlements requires the `OPERATOR_ROLE`. If you need to create one, contact an Operator.

---

### 11.8 Trading

**Path:** `/trading` · **Access:** All users

As an Agent, you can trade like any investor:

1. Select a market from the **market selector** dropdown
2. View market stats: Last Price, Best Bid/Ask, Spread, Total Orders, Total Trades
3. Check your balances (security token + cash)
4. Place orders:
   - Toggle **Buy** or **Sell**
   - Enter **Price (HKD per token)** and **Quantity**
   - Review the **Estimated Total**
   - Click **"Place Buy Order"** or **"Place Sell Order"**
5. The system auto-approves the required token allowance, then submits the order
6. If matched instantly, a success message shows trades executed

View the live **Order Book** panel with buy (green) and sell (red) orders.

---

### 11.9 Portfolio

**Path:** `/portfolio` · **Access:** All users

View your wallet's complete token holdings, balances, and transaction history.

---

## 12. What You Cannot Do (Admin-Only)

The following operations require `DEFAULT_ADMIN_ROLE` and are not available to Agents:

| Operation | Page | Why Admin-Only |
|-----------|------|---------------|
| Create new security tokens | Token Management | Token creation is a strategic decision |
| Deactivate / reactivate tokens | Token Management | Affects all holders |
| Upgrade V2 token implementations | Token Management | Smart contract upgrade risk |
| Create new trading markets | Market Management | Market structure decision |
| Deactivate / reactivate markets | Market Management | Affects all traders |
| Set jurisdiction whitelist | Compliance Rules | Regulatory policy decision |
| Set concentration caps | Compliance Rules | Risk management policy |
| Set lock-up periods | Compliance Rules | Contractual obligation |
| Set max supply | Token Minting (config) | Supply cap is a governance decision |
| Set mint threshold | Token Minting (config) | Governance threshold is a policy decision |
| Force-cancel trade orders | Trading | Admin enforcement power |
| Mint test ETH | Mint ETH (Test) | Development/testing tool |
| Execute forced transfers (ERC-1644) | Smart contract only | Court-ordered transfers |
| Grant / revoke roles | Smart contract only | Access control management |
| Emergency pause contracts | Smart contract only | System-wide emergency action |

If you need any of these operations performed, contact a platform Admin.

---

## 13. Troubleshooting

### "Not registered" or "Not verified" Error When Minting

The recipient must be fully KYC'd before tokens can be minted.

**Fix:**
1. Go to **KYC Management** → **Lookup Investor** → enter the address
2. Check if the investor is Registered and Verified
3. If not registered: register them (Section 8.1)
4. If registered but not verified: issue claim topic 1 — KYC Verified (Section 8.2)

### Mint Fails with "Amount exceeds threshold"

The mint amount exceeds the governance threshold.

**Fix:**
- Reduce the amount to at or below the threshold shown in the Supply Safeguards banner
- OR ask an Admin to create a governance proposal for a large mint

### "KYC Verification Required" Banner on Trading

Your own Agent address may not have KYC claims issued.

**Fix:** Ask an Admin or another Agent to register your address and issue KYC claims, or self-register if you have `AGENT_ROLE`.

### Freeze Did Not Apply to All Tokens

Check that you clicked **"Freeze"** (not just looked up the address). The freeze call iterates across all tokens. If a transaction failed mid-way, retry.

**Verify:** Use **Check Frozen Status** → **"Lookup"** to confirm the per-token freeze status.

### Cannot Create a Settlement

Settlement creation requires the `OPERATOR_ROLE`, which Agents do not have by default.

**Fix:** Contact an Operator (e.g., `0x627306090abaB3A6e1400e9345bC60c78a8BEf57`) to create the settlement.

### Cannot See Admin Pages

Pages like Token Management, Market Management, Compliance Rules, and Mint ETH are Admin-only. This is expected behavior for the Agent role. See [Section 12](#12-what-you-cannot-do-admin-only).

### Wallet Shows Wrong Role Badge

Role detection reads on-chain roles. If your expected role is missing:
1. Confirm you are connected with the correct address
2. Ask an Admin to verify your role grant on the Identity Registry contract
3. Try disconnecting and reconnecting the wallet

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
