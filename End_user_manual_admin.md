# TokenHub — Admin End-User Manual

> HKSTP Security Token Platform · Administrator Guide  
> Version 1.0 · April 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Prerequisites](#2-system-prerequisites)
3. [Starting the Platform](#3-starting-the-platform)
4. [Connecting as Admin](#4-connecting-as-admin)
5. [Dashboard](#5-dashboard)
6. [End-to-End Workflow: Issuing a New Security Token](#6-end-to-end-workflow-issuing-a-new-security-token)
   - 6.1 [Step 1 — Create a Security Token](#61-step-1--create-a-security-token)
   - 6.2 [Step 2 — Configure Compliance Rules](#62-step-2--configure-compliance-rules)
   - 6.3 [Step 3 — Register Investors (KYC)](#63-step-3--register-investors-kyc)
   - 6.4 [Step 4 — Mint Tokens to Investors](#64-step-4--mint-tokens-to-investors)
   - 6.5 [Step 5 — Create a Trading Market](#65-step-5--create-a-trading-market)
   - 6.6 [Step 6 — Monitor Trading](#66-step-6--monitor-trading)
   - 6.7 [Step 7 — Settle Trades (DvP)](#67-step-7--settle-trades-dvp)
   - 6.8 [Step 8 — Deploy Governance](#68-step-8--deploy-governance)
   - 6.9 [Step 9 — Compliance Operations (Force Cancel + Force Transfer)](#69-step-9--compliance-operations-force-cancel--force-transfer)
7. [Admin Page Reference](#7-admin-page-reference)
   - 7.1 [Token Management](#71-token-management)
   - 7.2 [KYC Management](#72-kyc-management)
   - 7.3 [Token Minting](#73-token-minting)
   - 7.4 [Compliance Rules](#74-compliance-rules)
   - 7.5 [Market Management](#75-market-management)
   - 7.6 [Freeze Management](#76-freeze-management)
   - 7.7 [Oracle Committee](#77-oracle-committee)
   - 7.8 [Wallet Custody](#78-wallet-custody)
   - 7.9 [Governance](#79-governance)
   - 7.10 [DvP Settlement](#710-dvp-settlement)
   - 7.11 [Trading](#711-trading)
   - 7.12 [Mint ETH (Test)](#712-mint-eth-test)
8. [Role-Based Access Summary](#8-role-based-access-summary)
9. [Production Hardening](#9-production-hardening)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

**TokenHub** is an end-to-end security token issuance, trading, and settlement platform designed for HKSTP (Hong Kong Science & Technology Parks) startup companies. The platform is deployed on an EVM-compatible blockchain and provides:

- **Security token lifecycle management** — create, mint, burn, freeze, and transfer tokens representing equity in startup companies
- **KYC / AML compliance** — on-chain identity registry with claim-based verification
- **Order-book trading** — fully on-chain limit order book with automatic matching
- **Delivery-versus-Payment (DvP) settlement** — atomic, simultaneous exchange of tokens for cash
- **Governance** — on-chain voting with timelock-controlled execution for critical operations
- **Custody** — multi-tier wallet management with multi-signature warm wallet

The **Admin** role has full platform control including token creation, compliance configuration, investor onboarding, market creation, and emergency operations.

---

## 2. System Prerequisites

| Component | Requirement |
|-----------|-------------|
| **Node.js** | v18 or higher |
| **npm** | v9 or higher |
| **Anvil** | Foundry's local EVM node (installed via `foundryup`) |
| **Browser** | Chrome or Firefox with MetaMask extension |
| **MetaMask** | Network configured for Chain ID `31337`, RPC `http://127.0.0.1:8545` |

### Default Admin Account

| Field | Value |
|-------|-------|
| Label | Admin / Deployer |
| Address | `0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73` |
| Private Key | `0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63` |
| Roles | `DEFAULT_ADMIN_ROLE` + `AGENT_ROLE` |

> **Note:** This private key is a well-known Hardhat/Besu test key. Never use it on a public network.

---

## 3. Starting the Platform

### 3.1 Start the Blockchain Node

Open a terminal and run:

```powershell
anvil --host 0.0.0.0 --port 8545 --no-request-size-limit
```

### 3.2 Load Pre-existing State (Recommended)

If a state snapshot exists (e.g., `anvil-snapshot-2026-04-25T12-29-26.json`), load it via the helper script:

```bash
./scripts/load-anvil-state.sh anvil-snapshot-2026-04-25T12-29-26.json
```

The script reads the snapshot (raw hex), POSTs an `anvil_loadState` JSON-RPC request to `http://127.0.0.1:8545`, and exits non-zero unless Anvil returns `result:true`. To target a different RPC URL: `RPC_URL=http://127.0.0.1:8546 ./scripts/load-anvil-state.sh path/to/snapshot.json`.

**Manual fallback** (if the script is unavailable — note that the snapshot is a raw hex string, so `JSON.parse` will fail; read it as a plain string):

```bash
node -e "
  const fs = require('fs');
  const state = fs.readFileSync('anvil-snapshot-2026-04-25T12-29-26.json', 'utf8').trim();
  fs.writeFileSync('anvil-load-request.json', JSON.stringify({jsonrpc:'2.0',method:'anvil_loadState',params:[state],id:1}));
"
curl -s -X POST -H "Content-Type: application/json" --data-binary @anvil-load-request.json http://127.0.0.1:8545
```

> **Important:** State must be loaded via the `anvil_loadState` RPC method, NOT the `--load-state` CLI flag.

### 3.2.1 Take a Snapshot

Before any irreversible operation (e.g., a hardening run, governance execution, or force-transfer), capture state with:

```bash
TS=$(date -u +"%Y-%m-%dT%H-%M-%S")
curl -s -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"anvil_dumpState","params":[],"id":1}' \
  http://127.0.0.1:8545 \
  | node -e "let b='';process.stdin.on('data',d=>b+=d).on('end',()=>{require('fs').writeFileSync(process.argv[1],JSON.parse(b).result)})" \
    "anvil-snapshot-${TS}.json"
```

The resulting `anvil-snapshot-<timestamp>.json` can be reloaded with the script above to roll back to that point.

### 3.3 Fix the Blockchain Clock

After loading state, the blockchain timestamp may be in the past. Advance it:

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

### 3.4 Start the Frontend

```powershell
cd frontend
npm run dev
```

The application opens at **http://localhost:3000/**.

### 3.5 Deploy Fresh (Alternative)

If no snapshot is available, deploy all contracts from scratch:

```powershell
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost
```

This deploys all 18 contracts, configures roles, wires governance, and updates the frontend config automatically.

---

## 4. Connecting as Admin

1. Open **http://localhost:3000/** in your browser
2. In the sidebar, click **"Connect Wallet"** at the bottom
3. Choose one of:
   - **Built-in Test Accounts → Admin / Deployer** (recommended for development)
   - **MetaMask** — import the admin private key into MetaMask first
   - **Custom Private Key** — paste the admin private key with a label
4. The sidebar now shows:
   - `Connected (Built-in)` with address `0xFE3B…Bd73 · Chain 31337`
   - Role badge: **ADMIN** (yellow)
5. All admin-restricted pages become visible in the sidebar

### Wrong Network Warning

If MetaMask is on a different chain, a red banner appears:

> "Wrong network detected (Chain ID: ?). Please switch to Hardhat Devnet (Chain ID: 31337)."

Click **"Switch Network"** to auto-configure MetaMask.

### Navigation Items Visible to Admin

| Page | Sidebar Label | Badge |
|------|--------------|-------|
| Dashboard | Dashboard | — |
| KYC Management | KYC Management | `Staff` |
| Token Minting | Token Minting | `Staff` |
| DvP Settlement | DvP Settlement | — |
| Trading | Trading | — |
| Market Management | Market Management | `Admin` |
| Compliance Rules | Compliance Rules | `Admin` |
| Oracle Committee | Oracle Committee | `Privileged` |
| Token Management | Token Management | `Admin` |
| Wallet Custody | Wallet Custody | `Privileged` |
| Freeze Management | Freeze Management | `Staff` |
| Governance | Governance | — |
| Portfolio | Portfolio | — |
| Mint ETH (Test) | Mint ETH (Test) | `Admin` |

---

## 5. Dashboard

The Dashboard is the landing page after connecting your wallet.

### Admin Stats (Top Row)

As an admin, you see **total supply cards** for every token:

- **HKSAT Total Supply** — click to navigate to the token detail page
- **{SYMBOL} Total Supply** — one card per factory-deployed token
- **THKD Total Supply** — click to navigate to the cash token page

### My Token Holdings

Shows the admin wallet's security token and cash token balances.

### KYC / AML Claims

Shows the current wallet's KYC status and per-topic claim status:

| Topic | Description |
|-------|-------------|
| 1 | KYC Verified |
| 2 | Accredited Investor |
| 3 | Jurisdiction Approved |
| 4 | Source of Funds |
| 5 | PEP/Sanctions Clear |
| 6 | FPS Name-Match |

### Market Overview

Table showing all active order-book markets with columns: **Market**, **Last Price**, **Best Bid**, **Best Ask**, **Trades**.

### System Health

- Click **"Run Health Check"** to verify all on-chain contracts
- Results show **Total / Passed / Failed** counts
- Each check displays a pass (✓) or fail (✗) with detail text
- Checks cover: identity registry, compliance, security token, cash token, DvP settlement, order book, governance, custody, and oracle committee contracts

---

## 6. End-to-End Workflow: Issuing a New Security Token

This section walks through the complete lifecycle from token creation to trading, as performed by an admin.

---

### 6.1 Step 1 — Create a Security Token

**Navigate to:** Sidebar → **Token Management**

1. Select the tab for the token type:
   - **V1 — Immutable Clones (EIP-1167)** — lightweight, fixed-logic tokens
   - **V2 — Upgradeable Proxies (ERC-1967)** — supports future logic upgrades

2. Fill in the **Create New Startup Token** form:

   | Field | Example |
   |-------|---------|
   | Token Name | `HKSTP BioTech Alpha Token` |
   | Token Symbol | `HKBA` (max 10 characters, auto-uppercased) |

3. Click **"Create Token"** (V1) or **"Create Upgradeable Token"** (V2)

4. Confirm the MetaMask/wallet transaction

5. The new token appears in the token list below with status **ACTIVE**

> **What happens on-chain:** The TokenFactory deploys an EIP-1167 clone (V1) or ERC-1967 proxy (V2) of the HKSTPSecurityToken implementation. The token is auto-registered in the WalletRegistry and auto-safe-listed on the MultiSigWarm wallet.

---

### 6.2 Step 2 — Configure Compliance Rules

**Navigate to:** Sidebar → **Compliance Rules**

#### 6.2.1 Set Jurisdiction Whitelist

Investors are restricted by country code. Allow the jurisdictions you accept:

1. Enter a **Country Code** (e.g., `HK`)
2. Select **Allow**
3. Click **"Update Jurisdiction"**

Repeat for each permitted jurisdiction. Blocked jurisdictions show a red (✗) badge.

#### 6.2.2 Set Global Concentration Cap

Prevent any single investor from holding too much of one token:

1. Select the **Token** from the dropdown
2. Enter the **Global Cap (tokens)** (e.g., `100000`)
3. Click **"Set"**

#### 6.2.3 Set Per-Investor Cap (Optional)

For specific investors with different limits:

1. Select the **Token**
2. Enter the **Investor Address**
3. Enter the **Max Balance (tokens)**
4. Click **"Set Per-Investor Cap"**

#### 6.2.4 Set Lock-Up Period (Optional)

Restrict an investor from transferring tokens until a date:

1. Select the **Token**
2. Enter the **Investor Address**
3. Pick the **Lock-Up End Date** using the datetime picker
4. Click **"Set Lock-Up"**

To remove a lock-up, click **"Remove"**.

---

### 6.3 Step 3 — Register Investors (KYC)

**Navigate to:** Sidebar → **KYC Management**

#### 6.3.1 Register an Investor's Identity

1. Enter the **Investor Address** (e.g., `0x5e33...46f3`)
2. Select the **Country Code** (e.g., `HK`)
3. Choose **Registration Mode**:
   - **ONCHAINID** — deploys a dedicated ERC-735 identity contract for the investor (production-grade)
   - **Boolean** — simple flag-based registration (faster, suitable for testing)
4. Click **"Register Identity"**

#### 6.3.2 Issue KYC Claims

After registration, the investor needs verified claims to pass compliance checks:

1. Choose claim mode:
   - **Signed Claim (ONCHAINID)** — cryptographically signed ERC-735 claim
   - **Boolean Claim** — simple true/false flag
2. Enter the **Investor Address**
3. Select the **Claim Topic**:
   - `1` — KYC Verified
   - `2` — Accredited Investor
   - `3` — Jurisdiction Approved
   - `4` — Source of Funds
   - `5` — PEP/Sanctions Clear
   - `6` — FPS Name-Match
4. For signed claims: set Action to **Issue** (or **Revoke** to remove)
5. For boolean claims: set Value to **true**
6. Click **"Issue Signed Claim"** or **"Set Boolean Claim"**

> **Minimum for trading:** An investor needs at least claim topic `1` (KYC Verified) to be marked as verified. Issue all relevant topics for full compliance.

#### 6.3.3 Verify Registration

Use the **Lookup Investor** section:

1. Enter the investor's **Address**
2. Click **"Lookup"**
3. Confirm the display shows:
   - Registration Status: ✓ Registered
   - Verified Status: ✓ Verified
   - Country code
   - Identity contract address
   - All claim statuses

---

### 6.4 Step 4 — Mint Tokens to Investors

**Navigate to:** Sidebar → **Token Minting**

#### 6.4.1 Select the Token

Use the **Token Selector** dropdown at the top to choose the token you created in Step 1.

#### 6.4.2 Mint Security Tokens

1. Enter the **Recipient Address** (must be a KYC-registered and verified investor)
2. Enter the **Amount** (e.g., `10000`)
3. Click **"Mint {SYMBOL}"**

> **Pre-check:** The system validates the recipient is registered AND verified in the Identity Registry before minting. If not, a specific error message is shown.

#### 6.4.3 Mint Cash Tokens (THKD)

Investors need cash tokens to participate in trading:

1. In the **Mint Cash Token (THKD)** section, enter the **Recipient Address**
2. Enter the **Amount** (e.g., `5000000` for 5,000,000 THKD)
3. Click **"Mint THKD"**

#### 6.4.4 Configure Supply Safeguards (Optional)

Expand the **Supply Safeguard Configuration** section:

- **Set Max Supply** — absolute cap on total token supply. Enter value and click **"Set Max Supply"**. Set to `0` for unlimited.
- **Set Mint Threshold** — mints above this amount require governance approval via the Timelock. Enter value and click **"Set Mint Threshold"**.

> **Note:** When a mint threshold is set, any mint exceeding it can only be executed by the `TIMELOCK_MINTER_ROLE`, which requires a governance proposal to pass and be queued through the Timelock.

---

### 6.5 Step 5 — Create a Trading Market

**Navigate to:** Sidebar → **Market Management**

1. In the **Create New Market** form:

   | Field | Example |
   |-------|---------|
   | Security Token | Select `HKBA` from dropdown (only tokens without existing markets appear) |
   | Decimals | Auto-detected (typically `18`) |
   | Market Name | `HKBA / HKD` |
   | Symbol | `HKBA` |

2. Click **"Create Market"**

3. The new market appears in the **All Markets** table with status **ACTIVE**

> **What happens on-chain:** The OrderBookFactory deploys a new OrderBook contract. The new OrderBook is automatically safe-listed on the security token (exempt from certain compliance checks so it can hold tokens during order matching).

---

### 6.6 Step 6 — Monitor Trading

**Navigate to:** Sidebar → **Trading**

Once a market is created and investors have tokens + cash:

1. Select the market from the **market selector** dropdown at the top
2. View the **Market Overview** stat cards: Last Price, Best Bid, Best Ask, Spread, Total Orders, Total Trades
3. Monitor the **Order Book** panel showing live buy (green) and sell (red) orders

### Admin Actions on Trading

The Trading page itself does not expose admin-only controls — admins place orders the same way investors do. Compliance actions against a specific investor (force-cancel orders, cancel pending mint proposals, cancel pending settlements, force-transfer balances) live in **KYC Management → Compliance — Force Cancel**. See [§7.2 KYC Management](#72-kyc-management) and the new [Step 9 — Compliance Operations](#69-step-9--compliance-operations-force-cancel--force-transfer) workflow.

---

### 6.7 Step 7 — Settle Trades (DvP)

**Navigate to:** Sidebar → **DvP Settlement**

For off-book trades or negotiated deals requiring atomic settlement:

1. Fill in the **Create Settlement** form:

   | Field | Example |
   |-------|---------|
   | Seller Address | `0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef` |
   | Buyer Address | `0x821aEa9a577a9b44299B9c15c88cf3087F3b5544` |
   | Security Token | Select from dropdown (e.g., `HKBA — HKSTP BioTech Alpha Token`) |
   | Security Token Amount | `100` |
   | Cash Amount (THKD) | `50000` |
   | Deadline (hours from now) | `24` |

2. Click **"Create Settlement"**

3. The settlement appears in the **Settlement History** table with status **Pending** (amber)

4. To execute: click **"Execute"** next to the settlement. The system auto-approves token transfers and performs an atomic swap: tokens move from seller → buyer, cash moves from buyer → seller, simultaneously.

5. For batch operations: check multiple pending settlements and click **"Batch Execute (N)"**

### Settlement Statuses

| Status | Badge Color | Meaning |
|--------|------------|---------|
| Pending | Amber | Awaiting execution |
| Settled | Green | Successfully completed |
| Failed | Red | Execution failed |
| Cancelled | Gray | Manually cancelled |
| Expired | Orange | Past deadline |

---

### 6.8 Step 8 — Deploy Governance

**Navigate to:** Sidebar → **Governance**

For each token that needs decentralized governance:

1. Select the token from the **Token Selector** dropdown
2. If no governance exists, click **"Deploy Governance"**
3. This deploys a **Governor** contract + **Timelock** contract and registers them via the GovernorFactory

### Creating a Governance Proposal

1. Delegate voting power: in the **Voting Power** section, enter your address and click **"Delegate"** (you must delegate to yourself to activate voting)
2. Click **"Create Proposal"**
3. Select **Type**:
   - **Signaling** — text-only, non-binding vote
   - **Executable** — will execute on-chain actions after passing
4. For executable proposals:
   - Select **Action**: e.g., `mint`
   - Enter **Param 1**: recipient address
   - Enter **Param 2**: amount
5. Enter a **Description**
6. Click **"Submit Proposal"**

### Proposal Lifecycle

| State | Description | Admin Action |
|-------|-------------|-------------|
| Pending | Waiting for voting delay to pass | Wait |
| Active | Voting open | Cast vote: **For** / **Against** / **Abstain** |
| Succeeded | Vote passed | Click **"Queue"** to queue in Timelock |
| Queued | In Timelock waiting period (48h) | Wait (or **"Skip Timelock"** on devnet) |
| Ready | Timelock delay passed | Click **"Execute"** |
| Executed | Action completed | — |
| Defeated | Vote failed | — |
| Canceled | Manually canceled | — |

---

### 6.9 Step 9 — Compliance Operations (Force Cancel + Force Transfer)

When an investor is flagged as non-compliant (sanctions hit, lost wallet, court order, liquidator directive), the Custodian unwinds their on-chain footprint and — if required — sweeps their tokens to a recovery wallet.

**Navigate to:** Sidebar → **KYC Management** → scroll to **Compliance — Force Cancel**

#### 6.9.1 Scan the Non-Compliant Investor

1. Enter the **Investor Address** in the Compliance — Force Cancel section
2. Click **"Scan"**

The scanner walks every active market, every governance suite, every DvP settlement, and every security token, and returns:

| List | What It Finds |
|------|---------------|
| **Outstanding Trade Orders** | Open / partially-filled orders the investor placed in any active OrderBook |
| **Pending Mint Proposals** | Active or queued governance proposals that target the investor's address |
| **Pending DvP Settlements** | Settlements with status `Pending` where the investor is buyer or seller |
| **Force Transfer (ERC-1644)** | Per-token rows of the investor's non-zero security-token balances |
| **History / Audit Trail** | Collapsible: completed transfers, completed orders, completed settlements, completed proposals |

#### 6.9.2 Cancel Outstanding Activity

For each list, click the per-row cancel button:

- **Cancel** (per trade order) → calls `OrderBook.forceCancelOrder(id, reason)`
- **Cancel Proposal** → calls `Governor.cancel(...)`
- **Cancel** (per settlement) → calls `DvPSettlement.cancelSettlement(id)`

#### 6.9.3 Force Transfer (Court-Order Recovery, ERC-1644)

> **Use only when authorised by a valid legal instrument** — this bypasses freeze checks and compliance modules. Each call must reference an on-chain anchored legal-order hash for SFC / HKMA auditability.

For each token row showing a non-zero balance:

| Field | Notes |
|-------|-------|
| **Recipient address (0x…)** | Must be Identity-Registry verified (the UI pre-checks `isVerified(to)` before signing). Cannot equal the caller — contract rejects self-dealing. |
| **Amount** | ≤ current balance; in display units (the UI uses 18-decimals `parseEther`). |
| **Legal order hash (bytes32)** | Required. `0x` + 64 hex chars. Typically the SHA-256 multihash digest of the encrypted court-order document on IPFS. Enforced on-chain: `require(legalOrderHash != bytes32(0))`. |
| **Operator data (optional hex)** | Free-form supplementary context (case reference, internal nonce, full IPFS CID string). Defaults to `0x`. |

Click **"Force Transfer"**. The handler:

1. Validates inputs locally (address, amount range, bytes32 hash, hex operator data).
2. Calls `identityRegistry.isVerified(to)` and aborts with a clear message if false.
3. Submits `securityToken.forcedTransfer(from, to, amount, legalOrderHash, operatorData)`.
4. Re-reads the source balance and updates / removes the row.
5. The contract emits `ForcedTransfer(controller, from, to, amount, legalOrderHash, operatorData)` for audit.

**Pre-recovery checklist** for the recovery wallet `to`:

- Registered in the Identity Registry (KYC Management → Register Identity)
- Has at least claim topic `1` (KYC Verified) issued
- In an allowed jurisdiction (Compliance Rules)
- ETH balance ≥ gas cost (Mint ETH (Test) on devnet, or fund externally)

> **Role gate:** `forcedTransfer` requires `AGENT_ROLE` on the security token. The KYC Management page is visible to Admin OR Agent, but a non-Agent admin will see the transaction revert. Use the Agent / Custodian account for production force-transfers.

---

## 7. Admin Page Reference

### 7.1 Token Management

**Path:** `/tokens` · **Access:** Admin only

Manage the creation and lifecycle of security tokens.

**V1 Tab — Immutable Clones (EIP-1167):**
- Create tokens with name and symbol
- Deploys lightweight, non-upgradeable clones
- **Deactivate** / **Reactivate** tokens

**V2 Tab — Upgradeable Proxies (ERC-1967):**
- Create upgradeable tokens
- **Upgrade Implementation:** Enter a new implementation address and click **"Upgrade All Tokens"** to atomically upgrade all V2 tokens
- Shows current implementation address
- **Deactivate** / **Reactivate** tokens

---

### 7.2 KYC Management

**Path:** `/kyc` · **Access:** Admin + Agent

Full investor identity lifecycle management plus compliance enforcement actions.

| Section | Purpose |
|---------|---------|
| **Register Identity** | Register a new investor with country code (ONCHAINID or Boolean mode) |
| **Issue Claims** | Issue or revoke KYC/AML claims (signed ERC-735 or boolean) |
| **Lookup Investor** | Query registration status, verification, claims, and identity contract |
| **Compliance — Force Cancel** | Scan a non-compliant investor; cancel outstanding orders, mint proposals, and settlements |
| **Force Transfer (ERC-1644 — Court-Order Recovery)** | Sweep a non-compliant investor's security-token balances to a recovery wallet under a legal order |
| **History / Audit Trail** (collapsible) | Completed transfers, orders, settlements, and proposals with block numbers and timestamps |

> **Heading note:** the on-screen section title is **"Compliance — Force Cancel"** (em-dash). Force Transfer rows render under that same red panel after a scan returns at least one non-zero security-token balance.

**Compliance — Force Cancel** flow:
1. Enter the investor's address and click **"Scan"**.
2. For each finding, click the per-row cancel button:
   - Trade orders → **"Cancel"** (calls `OrderBook.forceCancelOrder`)
   - Governance mint proposals → **"Cancel Proposal"** (calls `Governor.cancel`)
   - DvP settlements → **"Cancel"** (calls `DvPSettlement.cancelSettlement`)
3. Status feedback streams into the panel's status line.

**Force Transfer (ERC-1644)** flow:
1. After scan, security-token rows with non-zero balance appear with a current-balance display.
2. Per row, fill **Recipient address**, **Amount**, **Legal order hash (bytes32)**, and optional **Operator data**.
3. Click **"Force Transfer"** — the UI pre-checks `identityRegistry.isVerified(to)` (aborts if recipient not verified), then calls `securityToken.forcedTransfer(from, to, amount, legalOrderHash, operatorData)`.
4. After confirmation, the source balance is re-read; row is updated or removed if balance reaches zero.
5. The on-chain `ForcedTransfer(controller, from, to, amount, legalOrderHash, operatorData)` event provides the SFC / HKMA audit anchor.

See [§6.9 Step 9 — Compliance Operations](#69-step-9--compliance-operations-force-cancel--force-transfer) for the full end-to-end workflow.

---

### 7.3 Token Minting

**Path:** `/mint` · **Access:** Admin + Agent

| Section | Fields | Action |
|---------|--------|--------|
| **Mint Security Token** | Recipient Address, Amount | "Mint {SYMBOL}" |
| **Burn Security Token** | From Address, Amount | "Burn {SYMBOL}" |
| **Mint Cash Token** | Recipient Address, Amount | "Mint THKD" |
| **Burn Cash Token** | From Address, Amount | "Burn THKD" |
| **Supply Safeguards** | Max Supply, Mint Threshold | "Set Max Supply", "Set Mint Threshold" |

The page shows supply info cards with current total supply and supply cap usage (color-coded: green < 75%, yellow 75–90%, red > 90%).

---

### 7.4 Compliance Rules

**Path:** `/compliance` · **Access:** Admin only

| Section | Fields | Action |
|---------|--------|--------|
| **Jurisdiction Whitelist** | Country Code, Allow/Block | "Update Jurisdiction" |
| **Concentration Caps** | Token, Investor Address, Max Balance | "Set Per-Investor Cap" or "Set" (global) |
| **Lock-Up Period** | Token, Investor Address, Lock-Up End Date | "Set Lock-Up" or "Remove" |

Status display shows: Compliance Oracle address, Global Concentration Cap, jurisdiction badges (green ✓ allowed, red ✗ blocked).

---

### 7.5 Market Management

**Path:** `/markets` · **Access:** Admin only

| Section | Fields | Action |
|---------|--------|--------|
| **Create New Market** | Security Token, Decimals, Market Name, Symbol | "Create Market" |
| **All Markets Table** | #, Market, Symbol, Security Token, OrderBook, Created, Status | "Deactivate" / "Reactivate" |

Only tokens without an existing market appear in the creation dropdown.

---

### 7.6 Freeze Management

**Path:** `/freeze` · **Access:** Admin + Agent

Emergency freeze/unfreeze of investor addresses across ALL tokens simultaneously.

| Section | Fields | Action |
|---------|--------|--------|
| **Freeze / Unfreeze** | Wallet Address | **"Freeze"** (red) / **"Unfreeze"** (green) |
| **Check Frozen Status** | Address | **"Lookup"** — shows per-token freeze breakdown |

> **Effect:** A frozen address cannot send or receive any security token. The freeze applies across the default token and all factory-deployed tokens (V1 + V2).

---

### 7.7 Oracle Committee

**Path:** `/oracle` · **Access:** Admin + Agent + Operator

Multi-oracle compliance attestation verifier management.

| Section | Fields | Action |
|---------|--------|--------|
| **Oracle Members** | — | **"Remove"** (trash icon) per member |
| **Add Oracle** | Oracle Address | **"Add Oracle"** |
| **Set Threshold** | New Threshold (min 2) | **"Update Threshold"** |

Summary cards show: Oracle Members (X / MAX), Signature Threshold (N-of-M), Security Level (Multi-Sig or Single-Sig).

---

### 7.8 Wallet Custody

**Path:** `/custody` · **Access:** Admin + Agent + Operator

Multi-tier custody wallet system with multi-signature warm wallet.

#### Wallet Tiers

| Tier | Label | Purpose |
|------|-------|---------|
| Hot (1) | 🔥 Hot | Day-to-day operations, subject to cap (basis points of AUM) |
| Warm (2) | 🌡 Warm | Multi-sig controlled, for larger operational transfers |
| Cold (3) | ❄ Cold | Long-term storage, highest security |

#### Sections

| Section | Purpose |
|---------|---------|
| **Tier Breakdown** | Per-token balances across Hot/Warm/Cold, total AUM, hot cap warnings |
| **Register Wallet** | Register new wallets with address, tier, and label |
| **Registered Wallets** | List with deactivate/reactivate toggles |
| **MultiSig Warm Wallet** | Propose, confirm, execute, and cancel multi-sig transfers |
| **Admin Controls** | Add/Remove/Replace signers, set confirmation threshold |

#### MultiSig Warm Wallet Flow

1. **Propose:** Fill in Token, To Address, Amount, and Reason (sweep-to-cold / operational / rebalance) → click **"Propose"**
2. **Confirm:** Other signers click **"Confirm"** on the pending transaction
3. **Execute:** Once enough confirmations are collected (N-of-M), click **"Execute"**
4. **Cancel/Revoke:** Use **"Revoke"** to remove your confirmation, or **"Cancel"** to abort entirely

---

### 7.9 Governance

**Path:** `/governance` · **Access:** All (public page with admin-relevant features)

See [Step 8 — Deploy Governance](#68-step-8--deploy-governance) for full workflow.

**Governor Configuration** (set at deployment):

| Parameter | Default Value |
|-----------|--------------|
| Voting Delay | 48 hours |
| Voting Period | 7 days |
| Quorum | 10% of total supply |
| Proposal Threshold | 10,000 tokens |
| Timelock Delay | 48 hours |

---

### 7.10 DvP Settlement

**Path:** `/settlement` · **Access:** All (Operator role needed to create/execute)

See [Step 7 — Settle Trades](#67-step-7--settle-trades-dvp) for full workflow.

Key actions: Create Settlement, Execute, Cancel, Mark Failed, Batch Execute.

---

### 7.11 Trading

**Path:** `/trading` · **Access:** All

The Trading page is public — admins place and cancel their own orders the same way investors do. There are no admin-only controls on this page; compliance actions against another investor (force-cancel orders, cancel proposals/settlements, force-transfer balances) live in [§7.2 KYC Management → Compliance — Force Cancel](#72-kyc-management).

Order placement flow:
1. Select market from dropdown
2. Toggle **Buy** or **Sell**
3. Enter **Price (HKD per token)** and **Quantity**
4. Review the **Estimated Total**
5. Click **"Place Buy Order"** or **"Place Sell Order"**
6. The system auto-approves the required token allowance, then submits the order
7. If matched instantly: a success message shows the number of trades executed

---

### 7.12 Mint ETH (Test)

**Path:** `/mint-eth` · **Access:** Admin only

Credit test ETH to any address on the local devnet (for gas fees).

1. Enter the **Recipient Address**
2. Enter the **Amount (ETH)**
3. Click **"Mint ETH"**

> This calls `anvil_setBalance` on the local node. Only works on Anvil/Hardhat devnets.

---

## 8. Role-Based Access Summary

### On-Chain Roles

| Role | Hex Identifier | Capabilities |
|------|---------------|-------------|
| **DEFAULT_ADMIN_ROLE** | `0x00` | Full admin: grant/revoke all roles, configure compliance, deploy tokens, manage factories, emergency pause |
| **AGENT_ROLE** | `keccak256("AGENT_ROLE")` | KYC registration, mint (≤ threshold), burn, freeze/unfreeze, safe-list management |
| **OPERATOR_ROLE** | `keccak256("OPERATOR_ROLE")` | Create/execute/cancel DvP settlements, custody operations |
| **TIMELOCK_MINTER_ROLE** | `keccak256("TIMELOCK_MINTER_ROLE")` | Large mints exceeding governance threshold (granted to Timelock only) |
| **COMPLIANCE_OFFICER_ROLE** | `keccak256("COMPLIANCE_OFFICER_ROLE")` | Anchor CDD (Customer Due Diligence) records |
| **MLRO_ROLE** | `keccak256("MLRO_ROLE")` | Report suspicious activity (STR) |
| **ORACLE_ROLE** | `keccak256("ORACLE_ROLE")` | Oracle committee member attestations |
| **UPGRADER_ROLE** | `keccak256("UPGRADER_ROLE")` | Upgrade V2 token implementations |

### Pre-configured Test Accounts

| Label | Address | Roles |
|-------|---------|-------|
| Admin / Deployer | `0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73` | DEFAULT_ADMIN_ROLE, AGENT_ROLE |
| Operator | `0x627306090abaB3A6e1400e9345bC60c78a8BEf57` | OPERATOR_ROLE |
| Agent / Custodian | `0xf17f52151EbEF6C7334FAD080c5704D77216b732` | AGENT_ROLE |
| Seller (Investor) | `0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef` | — |
| Buyer (Investor) | `0x821aEa9a577a9b44299B9c15c88cf3087F3b5544` | — |

### Frontend Route Access Matrix

| Page | Admin | Agent | Operator | Investor |
|------|:-----:|:-----:|:--------:|:--------:|
| Dashboard | ✓ | ✓ | ✓ | ✓ |
| KYC Management | ✓ | ✓ | — | — |
| Token Minting | ✓ | ✓ | — | — |
| DvP Settlement | ✓ | ✓ | ✓ | ✓ |
| Trading | ✓ | ✓ | ✓ | ✓ |
| Market Management | ✓ | — | — | — |
| Compliance Rules | ✓ | — | — | — |
| Oracle Committee | ✓ | ✓ | ✓ | — |
| Token Management | ✓ | — | — | — |
| Wallet Custody | ✓ | ✓ | ✓ | — |
| Freeze Management | ✓ | ✓ | — | — |
| Governance | ✓ | ✓ | ✓ | ✓ |
| Portfolio | ✓ | ✓ | ✓ | ✓ |
| Mint ETH (Test) | ✓ | — | — | — |

---

## 9. Production Hardening

After initial setup and testing, run the hardening script to transfer admin control to governance:

```powershell
# Dry run first
npx hardhat run scripts/harden-admin.js --network localhost -- --dry-run

# Execute
npx hardhat run scripts/harden-admin.js --network localhost
```

### What changes after hardening

| Before | After |
|--------|-------|
| Deployer EOA holds `DEFAULT_ADMIN_ROLE` on all contracts | Timelock holds `DEFAULT_ADMIN_ROLE` on all contracts |
| Deployer can change compliance, create tokens, manage roles directly | All admin changes require a governance proposal → vote → Timelock (48h delay) |
| Deployer holds `AGENT_ROLE` | Deployer retains `AGENT_ROLE` only (day-to-day KYC, minting within threshold) |
| — | `TIMELOCK_MINTER_ROLE` granted to Timelock for large mints |

> **Warning:** After hardening, admin operations require governance proposals. This is irreversible without a governance vote to restore direct admin access.

---

## 10. Troubleshooting

### Wallet Not Connecting

- Ensure Anvil is running on port 8545
- Check MetaMask is on Chain ID `31337`
- Try disconnecting and reconnecting the wallet

### "KYC Verification Required" on Trading

The investor's address must:
1. Be registered in the Identity Registry
2. Have at least claim topic 1 (KYC Verified) issued
3. Be in an allowed jurisdiction

Go to **KYC Management → Lookup Investor** to diagnose.

### Minting Fails with "Not registered" / "Not verified"

The recipient must be KYC-registered and verified before tokens can be minted. Complete the KYC flow first (Section 6.3).

### "Governance required" Message on Mint

The mint amount exceeds the governance threshold. Either:
- Reduce the amount below the threshold
- Create a governance proposal to mint via the Timelock

### Transactions Stuck or Failing After State Load

The blockchain clock may be behind. Run the clock-fix script (Section 3.3).

### Force Transfer Reverts

| Error / Symptom | Cause | Fix |
|---|---|---|
| `"Recipient is not verified in the Identity Registry"` (UI pre-check) | Recovery wallet not registered + verified | Run KYC Management → Register Identity + Issue claim topic 1 for the recovery wallet, then retry |
| `"missing legal order hash"` (on-chain revert) | Hash field empty or `0x0000…` | Provide a non-zero `bytes32` (typically the SHA-256 multihash of the encrypted court order) |
| `"recipient not verified"` (on-chain revert) | UI pre-check skipped or registry state changed mid-tx | Re-verify recipient KYC; rescan |
| `"cannot force-transfer to caller"` | Recipient address equals the caller (msg.sender) | Use a different recovery wallet |
| `"insufficient balance"` | Amount exceeds source balance (possibly because another tx reduced it) | Click **Scan** again to refresh balances |
| `AccessControl: account ... is missing role 0x...` | Connected wallet lacks `AGENT_ROLE` on this token | Switch to the Agent / Custodian account (see §8) |

### Settlement Expired

If a settlement passes its deadline without execution, it transitions to **Expired**. Click **"Mark Failed"** to finalize it, then create a new settlement with a longer deadline.

### System Health Check Shows Failures

Click **"Run Health Check"** on the Dashboard. Review which contracts failed. Common issues:
- Contract address mismatch after redeployment — run `deploy-and-update-frontend.js` to sync addresses
- Missing role grants — check that all contracts have the required roles via the deployment script

### Remote Access via VS Code Dev Tunnels

For demo or remote access:
1. Forward ports **3000** and **8545** in VS Code Ports panel
2. Set port 3000 visibility to **Public**
3. Start frontend with: `$env:VITE_TUNNEL = "1"; npm run dev`
4. HMR is disabled through tunnels — manually refresh the browser after code changes
