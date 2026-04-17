# TokenHub Smart Contracts

> Permissioned security token platform integrated with Hong Kong Science & Technology Parks (HKSTP) for fractional equity tokenization, ONCHAINID identity management, tiered custody, on-chain governance, and atomic DvP settlement.

---

## Architecture Overview

TokenHub operates on a **Hardhat Network** (development) or **Hyperledger Besu** (production-like) EVM-compatible blockchain. The Hardhat Network is the recommended development environment — it auto-mines instantly, pre-funds accounts, and requires zero external dependencies. Besu is available as an optional production-like alternative with four validator nodes.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     INVESTOR PORTAL  (React / Vite)                      │
│  SSO+MFA │ KYC Upload │ Wallet │ Trading │ Market Mgmt │ Governance     │
│                          │ Portfolio │ Settlement │ Token Minting        │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │  KYC frontend guard
         ┌─────────────────────────▼────────────────────────┐
         │        COMPLIANCE / ORACLE SERVICE               │
         │  OracleCommittee — multi-sig EIP-712 attestation │
         │  Checks: KYC, lock-up, caps, jurisdiction        │
         └─────────────────────────┬────────────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────────────────────────┐
│                  HARDHAT NETWORK / BESU  (EVM)                           │
│                                                                          │
│  ┌─────────────────────┐  ┌───────────────────────┐  ┌───────────────┐  │
│  │ HKSTPSecurityToken  │  │ HKSTPIdentityRegistry │  │ TokenFactory  │  │
│  │  (ERC-3643 style)   │  │  (KYC/AML claims)     │  │ / FactoryV2   │  │
│  └────────┬────────────┘  └──────────┬────────────┘  └───────────────┘  │
│           │                          │                                   │
│  ┌────────▼────────────┐  ┌─────────▼───────────┐  ┌────────────────┐  │
│  │  HKSTPCompliance    │  │   DvPSettlement      │  │ OracleCommittee│  │
│  │  (attestation +     │  │   (atomic Leg1+Leg2) │  │ (multi-oracle) │  │
│  │   module checks)    │  │                      │  └────────────────┘  │
│  └─────────────────────┘  └──────────────────────┘                      │
│                                                                          │
│  ┌─────────────────────────────────────────────────┐ ┌────────────────┐ │
│  │  Trading Layer                                   │ │ Identity Layer │ │
│  │  OrderBookFactory → OrderBook (per token pair)   │ │ IdentityFactory│ │
│  │  KYC gate: identityRegistry.isVerified(trader)   │ │ Identity (734) │ │
│  │  Auto-matching engine + escrow settlement         │ │ ClaimIssuer    │ │
│  └─────────────────────────────────────────────────┘ └────────────────┘ │
│                                                                          │
│  ┌─────────────────────┐  ┌──────────────────────┐                      │
│  │  Custody Layer       │  │ Governance Layer     │                      │
│  │  WalletRegistry     │  │ HKSTPGovernor        │                      │
│  │  MultiSigWarm       │  │ HKSTPTimelock        │                      │
│  └─────────────────────┘  └──────────────────────┘                      │
│                                                                          │
│  ┌─────────────────────┐  ┌──────────────────────┐                      │
│  │  MockCashToken      │  │ SystemHealthCheck    │                      │
│  │  (ERC-20 / THKD)    │  │ (deployment wiring)  │                      │
│  └─────────────────────┘  └──────────────────────┘                      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 1  Custody Architecture

### 1.1  Cold Wallet vs. Hot Wallet Management

To comply with the SFC's updated conduct standards for Virtual Asset Trading Platforms (VATPs) issued on January 16, 2025, TokenHub implements a tiered storage architecture that prioritizes the security of client assets while maintaining operational liquidity.

#### 1.1.1  The "98 / 2" Asset Allocation Requirement

TokenHub adheres to the mandatory **98/2 Requirement** — at least 98 % of client virtual assets are stored in cold storage (offline), with no more than 2 % held in hot storage (online) for daily transaction processing.

| Wallet Tier | Connectivity | Storage Ratio | Primary Use Case | Security Control |
|-------------|-------------|--------------|-----------------|-----------------|
| **Hot Wallet** | Always Online | < 2 % | Instant withdrawals, FPS / tokenized deposit settlement | Real-time monitoring, IP whitelisting, HSM-protected hot keys |
| **Warm Wallet** | Partially Online | Transient | Buffer for rebalancing; daily transactional sweeps | Multi-signature (2-of-3) via `MultiSigWarm` contract |
| **Cold Wallet** | Air-Gapped | ≥ 98 % | Deep storage of long-term investor holdings | Fully offline private keys, physically secure safe boxes in HK |

#### 1.1.2  Cold Storage Security Standards

- **FIPS 140-2 Level 3+** HSMs — high resistance to physical tampering with identity-based authentication
- **Tamper-Active (Level 4) HSMs** for high-value startup tokens — instant zeroization of cryptographic parameters on physical attack
- **No Smart Contracts** inside cold custody — the cold wallet system is explicitly prohibited from using smart contracts for internal custody logic

#### 1.1.3  Air-Gapped Signing Workflow

1. **Construction** — unsigned transaction built on a "watch-only" online terminal
2. **Unidirectional Transfer** — unsigned tx transferred via animated QR codes or quarantined USB drive
3. **Offline Signing** — transaction signed on air-gapped machine; private key never leaves this environment
4. **Return & Broadcast** — signed bundle returned to online terminal and broadcast to the blockchain

#### 1.1.4  Key Ceremonies & Quorum Controls

- **Multi-Party Quorum** — key generation and backup retrieval require ≥ 3 independent Responsible Officers
- **Geographic Distribution** — backup seeds stored in geographically distinct, biometric-protected vaults within HK
- **Separation of Duties** — different organizational units hold different key shares to mitigate collusion

#### 1.1.5  Operational Flow & Rebalancing

1. **Automated Sweep** — upon receipt of client assets in hot storage, the system automatically moves excess funds into cold storage
2. **Withdrawal Fulfillment** — small withdrawals served from hot storage; shortfalls replenished from warm / cold after multi-approval
3. **Disruption Recovery** — business continuity plan ensures custody restoration within a 12-hour window

### 1.2  Custody Contracts

#### `custody/WalletRegistry.sol`
On-chain registry that tracks hot / warm / cold wallet addresses and enforces the 98/2 ratio.

| Feature | Description |
|---------|-------------|
| Wallet tiers | `Hot`, `Warm`, `Cold` enum — each address tagged and managed |
| Hot cap enforcement | Configurable `hotCapBps` (basis points) — `totalAUM()` vs `hotBalance()` checked on every tracked token |
| Automated sweep events | Emits `SweepRequired` when hot balance exceeds the cap; off-chain sweeper responds |
| Cold transfer blocking | `ColdTransferBlocked` event prevents unauthorized outflows from cold wallets |
| Token tracking | Admin can `addTrackedToken` / `removeTrackedToken` for multi-asset AUM calculation |
| Pausable | Emergency pause halts all wallet operations |

#### `custody/MultiSigWarm.sol`
2-of-3 multi-signature warm wallet contract for rebalancing flows.

| Feature | Description |
|---------|-------------|
| Propose / Confirm / Execute | Standard multi-sig lifecycle with `proposeTx` → `confirmTx` → `executeTx` |
| Expiry | Each transaction has a deadline; expired transactions cannot execute |
| Revoke | Signers can revoke confirmations before execution |
| Cancel | Proposer or any signer can cancel a pending transaction |
| Signer rotation | `replaceSigner()` allows rotating compromised keys |
| ReentrancyGuard | Prevents re-entrancy during token transfers |

---

## 2  Permissioned Custody & Transfer Model

Under the SFC's guidelines, tokenized assets cannot be managed through a purely "wallet-to-wallet" or self-custody approach typical of public DeFi protocols. TokenHub utilizes a **Permissioned Custody** model, mirroring the central securities depository (CSD) framework of the traditional market.

### 2.1  The Permissioned Ledger State Machine

Every transaction is intercepted by a compliance layer that validates the identity and eligibility of both sender and receiver, implemented through the ONCHAINID identity registry (ERC-3643 / T-REX standard).

| Ledger Component | Technical Implementation | Regulatory Goal |
|-----------------|------------------------|----------------|
| **Token Contract** | ERC-3643 (T-REX) compliant | Standardizes transfer logic with compliance hooks |
| **Identity Registry** | Mapping of addresses → ONCHAINID | Ensures all participants are KYC/AML verified |
| **Compliance Contract** | Modular rule sets + EIP-712 attestation | Enforces jurisdictional limits, investor caps, lock-ups |
| **Claim Topics Registry** | List of required verifications (6 topics) | Specifies required claims (e.g., PI status, FPS name-match) |

### 2.2  Transfer Flow

1. **Initiation** — participant calls `transfer(to, amount)`
2. **Eligibility Check** — token contract calls `IdentityRegistry` to verify receiver's ONCHAINID / KYC
3. **Compliance Check** — token contract calls `Compliance` to verify offering rules + attestation
4. **Balance Check** — system verifies sender has unfrozen balance sufficient for transfer
5. **Execution** — all checks pass → ledger updated; otherwise reverts with compliance error

### 2.3  Rejection of Self-Custody

The smart contract explicitly rejects any transaction involving an address not managed by a verified, licensed custodian.

### 2.4  Forced Transfers (`forcedTransfer()`)

The `forcedTransfer()` function (EIP-1644) allows a licensed custodian or platform administrator to reallocate tokens in response to a court order, liquidator instruction, or regulatory seizure.

**Function Signature:** `forcedTransfer(address _from, address _to, uint256 _amount, bytes calldata _data, bytes calldata _operatorData)`

| Authorization | Detail |
|--------------|--------|
| Protected by | `onlyAgent` — assigned to licensed custodian |
| Bypass | Skips `canTransfer()` and sender signature checks |
| Receiver verification | Receiver must still be verified in IdentityRegistry |
| Audit trail | Emits `ControllerTransfer` / `ForcedTransfer` event with legal reference |
| Legal anchoring | `_operatorData` stores an IPFS CID pointing to encrypted court order / liquidator request |

---

## 3  Contract Descriptions

### 3.1  Core Token & Compliance

#### `HKSTPSecurityToken.sol`
ERC-3643 (T-REX) inspired security token — **one token per HKSTP portfolio startup**.

| Feature | Description |
|---------|-------------|
| Transfer control | Every transfer checks Identity Registry + Compliance modules |
| Safe-list | Operational addresses (treasury, escrow) bypass per-transfer attestation |
| Minting / Burning | `AGENT_ROLE` for day-to-day mints; `TIMELOCK_MINTER_ROLE` required above `mintThreshold` |
| Supply cap | `maxSupply` hard ceiling prevents unlimited inflation (0 = unlimited) |
| Pause | Admin can emergency-pause all transfers |
| Freeze | Agents can freeze individual addresses |

#### `HKSTPIdentityRegistry.sol`
Maps investor wallet addresses to ONCHAINID identity contracts (ERC-734/735 style).

| Claim Topic | Description |
|-------------|-------------|
| 1 | KYC Verified |
| 2 | Accredited Investor (Professional Investor) |
| 3 | Jurisdiction Approved (HK / non-sanctioned) |
| 4 | Source of Funds Verified |
| 5 | PEP / Sanctions Clear |
| 6 | FPS Name-Match Verified |

#### `HKSTPCompliance.sol`
Modular compliance contract — "**Policy off-chain, enforcement on-chain**".

- **EIP-712 attestation** — Per-transfer signed approval from Compliance Oracle, bound to `(from, to, amount, expiry, nonce)`
- **Replay protection** — Each attestation hash is one-time-use
- **Modules** — Concentration caps, jurisdiction whitelist / blacklist, lock-up enforcement

#### `DvPSettlement.sol`
Atomic **Delivery-versus-Payment** settlement contract.

```
Off-chain matching engine  →  createSettlement()
                           →  executeSettlement()
                               │
                               ├─ Leg 1: securityToken.transferFrom(seller → buyer)
                               └─ Leg 2: cashToken.transferFrom(buyer → seller)
                                  (both succeed or both revert)
```

Settlement lifecycle: `Pending → Settled | Failed | Cancelled`

#### `OrderBookFactory.sol`
Factory contract that deploys and registers **one OrderBook per security-token / cash-token pair**. Each listed token on TokenHub gets its own order book for trading against the shared cash token (tokenized HKD).

| Feature | Description |
|---------|-------------|
| `createOrderBook()` | Deploys a new `OrderBook` for a given security token, passing shared `cashToken`, `cashDecimals`, and `identityRegistry` |
| Market registry | Stores `securityToken → OrderBook` mapping; exposes `activeMarkets()`, `allMarkets()` |
| `identityRegistry` | Immutable reference passed to every OrderBook for KYC enforcement |
| Lifecycle | `deactivateMarket()` / `reactivateMarket()` to pause individual markets |
| Admin-only | `DEFAULT_ADMIN_ROLE` required to create / manage markets |

#### `OrderBook.sol`
On-chain **limit-order book** with automatic price-time priority matching for a single security-token ↔ cash-token pair.

| Feature | Description |
|---------|-------------|
| Limit orders | Investors place buy/sell orders with price + quantity |
| Auto-matching | New orders immediately match against best opposite-side orders |
| Partial fills | Remaining quantity stays on the book after a partial match |
| Escrow model | Buy orders lock cash tokens; sell orders lock security tokens into the contract |
| KYC gate | `identityRegistry.isVerified(msg.sender)` checked on every `placeBuyOrder()` and `placeSellOrder()` — non-KYC wallets are rejected at order time |
| Safe-listed | OrderBook contract is safe-listed on the security token so escrow→buyer transfers pass the token's `_update()` compliance hook |
| Cancel | Traders can cancel their own open orders and reclaim escrowed funds |
| Order book queries | `getBuyOrderIds()`, `getSellOrderIds()`, `getOrdersBatch()`, `getTradesBatch()` |
| Market stats | `bestBid()`, `bestAsk()`, `spread()`, `orderCount()`, `tradeCount()` |
| Pausable | Admin can emergency-pause all trading activity |

```
OrderBook KYC Enforcement Flow:

  Investor → placeBuyOrder(price, qty)
                │
                ├─ identityRegistry.isVerified(msg.sender)?
                │    NO  → revert "buyer not KYC verified"
                │    YES → lock cashToken escrow
                │              │
                │              ├─ match against best sell orders
                │              │    securityToken.transfer(orderBook → buyer)
                │              │    cashToken.transfer(escrow → seller)
                │              └─ remaining qty stays on book
                │
  Investor → placeSellOrder(price, qty)
                │
                ├─ identityRegistry.isVerified(msg.sender)?
                │    NO  → revert "seller not KYC verified"
                │    YES → lock securityToken escrow → match...
```

### 3.2  Identity Layer (`identity/`)

#### `identity/Identity.sol`
ONCHAINID identity contract (ERC-734/735 key management + claim storage). Each investor gets a unique on-chain identity that holds verifiable claims.

#### `identity/ClaimIssuer.sol` / `identity/IClaimIssuer.sol`
Trusted claim issuer contract — only approved issuers can attach KYC / AML / PI claims to identity contracts. Implements `isClaimValid()` signature verification.

#### `identity/IdentityFactory.sol`
Factory that deploys lightweight EIP-1167 minimal proxy Identity contracts per investor.

| Feature | Description |
|---------|-------------|
| Minimal proxy (EIP-1167) | Gas-efficient identity deployment via clone pattern |
| `deployIdentity()` | Creates a new Identity proxy, assigns management key to investor |
| `getIdentity()` | Look up the identity contract for a given investor address |
| Role-gated | `FACTORY_ROLE` required to deploy identities |

### 3.3  Oracle & Compliance

#### `OracleCommittee.sol`
Multi-oracle committee that replaces single-signer compliance attestation with a **threshold-based multi-signature** model.

> **Production-readiness note:** The devnet currently uses a single Compliance Oracle via `consumeAttestation()` for convenience. In a production SFC/VASP deployment, `HKSTPCompliance` would route transfers through `OracleCommittee.consumeMultiAttestation()`, requiring M-of-N independent oracle signatures per transfer. This eliminates the single-oracle key as a point of failure — a compromised key alone cannot forge compliance approvals.

| Feature | Description |
|---------|-------------|
| Threshold signatures | Configurable N-of-M oracle quorum for EIP-712 attestations |
| `verifyMultiAttestation()` | Verifies that enough distinct oracle members signed the same attestation digest |
| `consumeMultiAttestation()` | One-time-use consumption with replay protection |
| Oracle management | `addOracle()` / `removeOracle()` / `setThreshold()` — admin-gated |
| EIP-712 domain | Full domain separator for structured attestation data |

### 3.4  Token Factory

#### `TokenFactory.sol`
Factory contract that allows HKSTP admins to deploy new `HKSTPSecurityToken` instances — one per startup.

| Feature | Description |
|---------|-------------|
| `createToken()` | Deploys a new security token with shared IdentityRegistry + Compliance |
| Lifecycle management | `deactivateToken()` / `reactivateToken()` for startup lifecycle events |
| Infrastructure update | `setInfrastructure()` to rotate shared registry / compliance contracts |
| Query helpers | `allTokens()`, `activeTokens()`, `getTokenBySymbol()` |

#### `TokenFactoryV2.sol`
Upgraded factory with **ERC-1967 upgradeable proxy** support — each token is deployed behind a proxy for future logic upgrades.

| Feature | Description |
|---------|-------------|
| `UpgradeableTokenProxy` | ERC-1967 proxy per token — storage-compatible upgrades |
| `upgradeImplementation()` | Admin can upgrade the implementation contract for any deployed token |
| All V1 features | Plus `deployedProxyCount()` and implementation tracking |

### 3.5  Governance

#### `governance/HKSTPGovernor.sol`
Modified OpenZeppelin Governor — ensures only **verified identity holders** can vote, preventing flash-loan manipulation via snapshots and KYC checks.

| Voting Rule | Technical Detail | Purpose |
|-------------|-----------------|---------|
| Proposal threshold | 1 % of total supply | Prevents frivolous proposals |
| Voting delay | 2 days | Preparation period |
| Voting period | 7 days | Ensures review time |
| Quorum | 10 % of total supply | Ensures legitimacy |
| Timelock wait | 48 hours after vote | Allows exit before execution |
| KYC gate | `_castVote()` checks `IdentityRegistry.isVerified()` | Blocks non-KYC voters (emits `VoteBlockedKYC`) |

#### `governance/HKSTPTimelock.sol`
`TimelockController` — enforces a 48-hour execution delay on passed proposals, giving shareholders a final review window.

### 3.6  Operations & Utilities

#### `SystemHealthCheck.sol`
Read-only diagnostic contract that verifies all cross-contract wiring is correct post-deployment.

| Check | Description |
|-------|-------------|
| `_checkWiring()` | Validates IdentityRegistry ↔ Compliance ↔ Token ↔ Factory links |
| `_checkAdminRoles()` | Ensures correct role assignments across all contracts |
| `_checkOperational()` | Verifies contracts are unpaused and supply is non-zero |
| `_checkDeployment()` | Confirms all addresses are valid contracts (code size > 0) |
| `fullHealthCheck()` | Runs all checks and returns a structured report |

#### `mocks/MockCashToken.sol`
Simple ERC-20 representing tokenized HKD (Project Ensemble / FPS-backed stablecoin simulation).

---

## 4  Deposit / Withdrawal Workflow

TokenHub integrates Hong Kong's **FPS** (Faster Payment System) and **Project Ensemble** to support instant deposit, withdrawal, and atomic DvP settlement.

### 4.1  FPS Instant Deposits

| Step | Actor | Technical Action |
|------|-------|-----------------|
| Start | Investor | Chooses amount and receives FPS QR code |
| Pay | Investor's Bank | Sends money to TokenHub's safe account via FPS |
| Notify | Payment System | Sends payment confirmation message |
| Match | TokenHub Server | Connects payment to correct on-chain identity |
| Mint | Cash Contract | Mints digital HKD (THKD) for investor |

### 4.2  Safe Withdrawals

Withdrawals burn digital cash tokens and send funds back to verified bank accounts via FPS (closed-loop AML compliance).

### 4.3  Future: Project Ensemble

TokenHub will evolve toward tokenized deposits issued directly by banks, enabling wCBDC-powered atomic DvP across ledgers.

---

## 5  Contract Interaction Diagrams

### 5.1  DvP Settlement Flow

```
Investor (seller)                 DvPSettlement              Investor (buyer)
      │                                │                           │
      │  approve(dvp, tokenAmt)        │     approve(dvp, cashAmt) │
      │───────────────────────────►────│◄──────────────────────────│
      │                                │                           │
      │              [Matching engine calls createSettlement()]    │
      │                                │                           │
      │              [Matching engine calls executeSettlement()]   │
      │                                │                           │
      │         transferFrom(seller→buyer) ──►  HKSTPSecurityToken │
      │                                │          │ _update() hook │
      │                                │          ▼                │
      │                                │    HKSTPIdentityRegistry  │
      │                                │    HKSTPCompliance        │
      │                                │    OracleCommittee        │
      │                                │    (multi-sig attestation)│
      │                                │                           │
      │         transferFrom(buyer→seller) ──►  MockCashToken      │
      │◄───────────── THKD received ───│                           │
      │                                │      security token ─────►│
```

### 5.2  OrderBook Trading Flow

```
Investor (buyer)                OrderBook (escrow)            Investor (seller)
      │                                │                           │
      │  1. approve(ob, cashAmt)       │   1. approve(ob, tokenAmt)│
      │───────────────────────────►────│◄──────────────────────────│
      │                                │                           │
      │  2. placeBuyOrder(price, qty)  │   3. placeSellOrder(…)    │
      │───────────────────────────►────│◄──────────────────────────│
      │     ├─ isVerified(buyer)? ✓    │     ├─ isVerified(seller)?│
      │     └─ lock cashToken escrow   │     └─ lock secToken      │
      │                                │                           │
      │         [Auto-matching engine runs inside OrderBook]       │
      │                                │                           │
      │     securityToken.transfer     │                           │
      │     (orderBook → buyer)  ──────│──►  _update() compliance  │
      │                                │     (OrderBook safe-listed│
      │                                │      ∴ buyer isVerified)  │
      │                                │                           │
      │     cashToken.transfer         │                           │
      │     (escrow → seller)  ────────│──────────────────────────►│
      │                                │                           │
      │  ◄── security tokens received  │     THKD received ──────►│
```

### 5.3  Three-Layer KYC Enforcement

```
┌────────────────────────────────────────────────────────────────────┐
│                       Layer 1: OrderBook                            │
│  placeBuyOrder()  → identityRegistry.isVerified(msg.sender)       │
│  placeSellOrder() → identityRegistry.isVerified(msg.sender)       │
│  ⚡ Primary gate — blocks non-KYC at order time                    │
├────────────────────────────────────────────────────────────────────┤
│                  Layer 2: SecurityToken._update()                   │
│  Every transfer() / transferFrom() triggers compliance hook        │
│  OrderBook = safe-listed → skips own verification                  │
│  Counterparty (buyer/seller) still checked via isVerified()        │
│  Works regardless of tool (Portal, MetaMask, custom script)        │
├────────────────────────────────────────────────────────────────────┤
│                  Layer 3: Frontend (Trading.tsx)                    │
│  identityRegistry.isVerified(account) checked on page load         │
│  Red banner + disabled order form for non-KYC users                │
│  Last Traded Price + 24 h % Change derived from on-chain trades    │
│  Defense-in-depth — UX layer, not the enforcement layer            │
└────────────────────────────────────────────────────────────────────┘
```

---

## 6  Directory Structure

```
contracts/
├── HKSTPSecurityToken.sol        # ERC-3643 security token
├── HKSTPIdentityRegistry.sol     # KYC/AML claim registry
├── HKSTPCompliance.sol           # Modular compliance + EIP-712 attestation
├── DvPSettlement.sol             # Atomic delivery-vs-payment
├── OrderBookFactory.sol          # Deploys one OrderBook per token pair
├── OrderBook.sol                 # On-chain limit-order book with KYC gate
├── OracleCommittee.sol           # Multi-oracle threshold attestation
├── TokenFactory.sol              # One-click token deployment per startup
├── TokenFactoryV2.sol            # Upgradeable proxy factory (ERC-1967)
├── SystemHealthCheck.sol         # Post-deployment wiring verification
├── custody/
│   ├── WalletRegistry.sol        # Hot/Warm/Cold tier registry + 98/2 enforcement
│   └── MultiSigWarm.sol          # 2-of-3 multi-sig warm wallet
├── governance/
│   ├── HKSTPGovernor.sol         # OZ Governor + KYC-gated voting
│   └── HKSTPTimelock.sol         # 48-hour execution delay
├── identity/
│   ├── Identity.sol              # ONCHAINID (ERC-734/735)
│   ├── IIdentity.sol             # Identity interface
│   ├── ClaimIssuer.sol           # Trusted claim issuer
│   ├── IClaimIssuer.sol          # ClaimIssuer interface
│   └── IdentityFactory.sol       # EIP-1167 minimal proxy factory
└── mocks/
    └── MockCashToken.sol         # ERC-20 tokenized HKD mock
```

---

## 7  Setup & Installation

### Option A — GitHub Codespaces (One-Click)

1. Go to [github.com/ytcctl/FITE7001_Capstone_Project](https://github.com/ytcctl/FITE7001_Capstone_Project)
2. Click **Code → Codespaces → Create codespace on main**
3. Wait ~3 minutes — the `postCreateCommand` automatically installs, compiles, deploys, and starts the frontend
4. See the [project README](../README.md) for full Codespaces details

### Option B — Local Setup

#### Prerequisites
- Node.js ≥ 18 (required by Hardhat ^2.22.4)
- npm ≥ 9
- Docker (optional — only needed for Hyperledger Besu)

### Install dependencies

```bash
npm install
```

### Compile contracts

```bash
npm run compile
# or
npx hardhat compile
```

### npm Scripts Reference

| Script | Command | Description |
|--------|---------|-------------|
| `npm run compile` | `hardhat compile` | Compile all Solidity contracts |
| `npm test` | `hardhat test` | Run all Hardhat test suites |
| `npm run test:besu` | `hardhat test … --network besu` | Besu end-to-end integration tests |
| `npm run coverage` | `hardhat coverage` | Solidity code coverage report |
| `npm run deploy:local` | `hardhat run scripts/deploy.js --network localhost` | Deploy core contracts to local Hardhat node |
| `npm run deploy:besu` | `node scripts/deploy-besu.js` | Besu deploy (auto-spawns node + block producer) |
| `npm run deploy:besu:raw` | `hardhat run scripts/deploy.js --network besu` | Deploy to Besu (requires separate block producer) |
| `npm run clean` | `hardhat clean` | Remove artifacts & cache |

> **Recommended workflow:** Use `deploy-and-update-frontend.js` (see §9 below) instead of the individual `deploy:local` script — it deploys all 14 contracts, seeds Investor1, and auto-updates the frontend config.

---

## 8  Testing

```bash
npm test
# or
npx hardhat test
```

Run with gas reporting:

```bash
REPORT_GAS=true npx hardhat test
```

Run coverage:

```bash
npm run coverage
```

Run Besu end-to-end tests:

```bash
npm run test:besu
```

### Test Suites

| File | Coverage |
|------|---------|
| `test/HKSTPSecurityToken.test.js` | Deployment, minting, transfers, safe-list, pause, freeze, supply cap, tiered minting threshold, self-dealing prevention |
| `test/HKSTPCompliance.test.js` | Attestation verify/consume, replay protection, module checks |
| `test/DvPSettlement.test.js` | Settlement lifecycle, atomic execution, deadline, pause |
| `test/Identity.test.js` | ONCHAINID deployment, claim issuance, identity lookup |
| `test/OracleCommittee.test.js` | Multi-oracle attestation, threshold enforcement, oracle management |
| `test/TokenFactory.test.js` | Factory token creation, deactivation, symbol lookup |
| `test/Governance.test.js` | Proposal lifecycle, KYC-gated voting, timelock execution |
| `test/WalletArchitecture.test.js` | Wallet tiers, hot-cap enforcement, sweep events, multi-sig flows |
| `test/ShareholderCap.test.js` | 50-shareholder cap enforcement across transfers |
| `test/AML.test.js` | AML/KYC compliance rejection scenarios |
| `test/ActionPlan.test.js` | End-to-end action plan scenarios |
| `test/integration/besu-e2e.test.js` | Full Besu network end-to-end integration |

---

## 9  Deployment

### Local Hardhat Network (Recommended for Development)

Hardhat Network is the recommended development blockchain — it auto-mines transactions instantly, pre-funds dev accounts with 1,000,000 ETH each, and requires zero external dependencies (no Docker).

#### Quick Start (All-in-One)

```bash
# Terminal 1 — start the Hardhat node (stays running)
npx hardhat node

# Terminal 2 — compile and deploy everything
npx hardhat compile
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost
```

`deploy-and-update-frontend.js` is the **unified deploy script** that:
1. Deploys all **14 contracts** (IdentityRegistry → Compliance → SecurityToken → … → OrderBook → SystemHealthCheck)
2. Configures all roles, safe-lists, ONCHAINID wiring, governance, and custody links
3. **Seeds Investor1** — registers identity, sets KYC claims 1–5, issues ERC-735 on-chain claims, mints 10,000 HKSAT + 5,000,000 THKD
4. **Auto-updates** `frontend/src/config/contracts.ts` with all deployed addresses (including `orderBook`)
5. Runs `SystemHealthCheck.fullHealthCheck()` to verify wiring

> **Note:** The script auto-detects whether to use Hardhat Network (auto-mine) or Besu (Engine API block production) via `hasEngineAPI()` — no configuration needed.

#### Manual Start (Legacy — Two Separate Steps)

If you prefer the older per-script approach:

```bash
# Terminal 1 — start the Hardhat node
npx hardhat node

# Terminal 2 — deploy core contracts only (no OrderBook, no Investor1 seeding)
npx hardhat run scripts/deploy.js --network localhost
```

### Hyperledger Besu Network (Optional — Production-like)

Besu is available as an alternative for production-like testing with the Engine API block producer.

> **Known issue:** Besu versions 23.x–26.x ignore genesis `alloc` — dev accounts start with 0 ETH. Hardhat Network is recommended for development.

#### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 18 |
| Docker | Running (for the Besu container) |
| `.env.besu` | See below |

Create a `.env.besu` file in the project root (git-ignored):

```env
BESU_RPC_URL=http://127.0.0.1:8545
BESU_CHAIN_ID=31337
BESU_PRIVATE_KEYS=<deployer>,<operator>,<agent>,<seller>,<buyer>
COMPLIANCE_ORACLE=<oracle-address>
TREASURY_ADDRESS=<treasury-address>
ESCROW_ADDRESS=<escrow-address>
CUSTODIAN_ADDRESS=<custodian-address>
```

#### Deploy on Besu

```bash
# 1. Start the Besu container
npm run besu:start

# 2. Compile and deploy (auto-detects Besu Engine API)
npx hardhat compile
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost
```

The unified script detects the Besu Engine API on port 8551 and automatically spawns the block producer during deployment.

### Deployment Order

The unified `deploy-and-update-frontend.js` deploys contracts in this order:

| # | Contract | Purpose |
|---|----------|---------|
| 1 | `HKSTPIdentityRegistry` | KYC/AML claim storage |
| 2 | `HKSTPCompliance` | Attestation + module enforcement |
| 3 | `HKSTPSecurityToken` | ERC-3643 security token (linked to registry + compliance) |
| 4 | `MockCashToken` | Tokenized HKD (THKD) — replace with Project Ensemble in production |
| 5 | `DvPSettlement` | Atomic delivery-vs-payment settlement engine |
| 6 | `TokenFactory` | One-click token deployment per startup |
| 7 | `ClaimIssuer` | Trusted claim issuer for ERC-735 on-chain claims |
| 8 | `IdentityFactory` | EIP-1167 minimal proxy ONCHAINID factory |
| 9 | `HKSTPTimelock` | 48-hour execution delay for governance |
| 10 | `HKSTPGovernor` | OZ Governor + KYC-gated voting |
| 11 | `WalletRegistry` | Custody tier registry + 98/2 enforcement |
| 12 | `MultiSigWarm` | 2-of-3 warm wallet multi-sig |
| 13 | `OrderBook` | On-chain limit-order book with KYC gate |
| 14 | `SystemHealthCheck` | Post-deployment wiring verification (optional) |

After deployment, the script automatically:
- Configures all roles (AGENT, OPERATOR, TOKEN, FACTORY, etc.)
- Safe-lists treasury, escrow, DvP, and OrderBook addresses
- Wires ONCHAINID (ClaimIssuer ↔ IdentityFactory ↔ Registry)
- Wires governance (Governor → Timelock → Token)
- Wires custody (WalletRegistry tracked tokens + MultiSigWarm signers)
- Sets Cap.622 shareholder cap (50)
- **Seeds Investor1** with full KYC + 10,000 HKSAT + 5,000,000 THKD
- **Auto-updates** `frontend/src/config/contracts.ts`

### Post-Deployment Steps

> **Note:** When using `deploy-and-update-frontend.js`, steps 1–11 are performed automatically. The steps below are only needed for manual or custom deployments.

1. Grant `TOKEN_ROLE` on `HKSTPCompliance` to `HKSTPSecurityToken`
2. Grant `AGENT_ROLE` on `HKSTPSecurityToken` to licensed custodian wallets
3. Safe-list treasury, escrow, and custody addresses on the token
4. Set `maxSupply` on `HKSTPSecurityToken` (hard cap on total supply)
5. Set `mintThreshold` on `HKSTPSecurityToken` (e.g. 1 % of supply) and grant `TIMELOCK_MINTER_ROLE` to `HKSTPTimelock`
6. Grant `OPERATOR_ROLE` on `DvPSettlement` to the matching engine service account
7. Register investor identities via `IdentityFactory.deployIdentity()` + `HKSTPIdentityRegistry.registerIdentity()`
8. Set KYC claims via `HKSTPIdentityRegistry.setClaim()`
9. Safe-list each deployed OrderBook on its corresponding security token (`setSafeList(orderBookAddr, true)`)
10. Register wallet tiers in `WalletRegistry` (hot, warm, cold)
11. Configure `MultiSigWarm` signers and grant `PROPOSER_ROLE` / `EXECUTOR_ROLE` on `HKSTPTimelock` to `HKSTPGovernor`
12. Run `SystemHealthCheck.fullHealthCheck()` to verify all wiring
13. Run `scripts/harden-admin.js` to finalize admin role configuration

---

## 10  Security Considerations

- All transfers are gated by the Identity Registry (both parties must be KYC-verified)
- Compliance module checks run on every non-safe-listed transfer
- **Three-layer KYC enforcement on trading:**
  1. **OrderBook contract** — `identityRegistry.isVerified(msg.sender)` blocks non-KYC wallets at order placement
  2. **SecurityToken `_update()` hook** — per-party compliance checks on every token transfer (including escrow)
  3. **Frontend KYC guard** — Trading UI checks verification status and disables order forms for non-KYC users
- **OrderBook safe-listing** — each OrderBook is safe-listed on its security token so escrow transfers succeed, but the counterparty (buyer/seller) is still independently verified
- **Cannot bypass via MetaMask** — all enforcement is at the smart contract layer; external tools (MetaMask, Etherscan, custom scripts) trigger the same `_update()` compliance hook
- **OracleCommittee** requires threshold-based multi-oracle attestation — no single point of failure
- DvP uses `ReentrancyGuard` to prevent re-entrancy attacks
- OrderBook uses `ReentrancyGuard` to prevent re-entrancy during escrow + matching
- Emergency pause available on token, DvP, OrderBook, and WalletRegistry contracts
- Attestations are one-time-use (replay protection via nonce + used-hash mapping)
- `AccessControl` used throughout — role-based, no single-owner risk
- Follows checks-effects-interactions pattern in `executeSettlement()` and `_executeTrade()`
- **Supply cap** — `maxSupply` prevents unlimited inflation; cannot be set below current `totalSupply()`
- **Tiered minting** — `mintThreshold` forces large issuances through `TIMELOCK_MINTER_ROLE` (Governor → Timelock 48 h delay), while routine operational mints stay with `AGENT_ROLE`
- **Self-dealing prevention** — `mint()` and `forcedTransfer()` reject `to == msg.sender`, preventing privileged operators from minting or force-transferring tokens to themselves
- **98/2 custody ratio** enforced on-chain via `WalletRegistry` with automated sweep alerts
- **Multi-sig warm wallet** (`MultiSigWarm`) requires 2-of-3 for rebalancing
- Air-gapped cold storage with FIPS 140-2 Level 3+ HSMs
- Governor + Timelock provide a 48-hour review window before on-chain governance execution
- `SystemHealthCheck` provides automated post-deployment verification

---

## 11  SFC Regulatory Alignment

| Requirement | Implementation |
|-------------|----------------|
| Investor suitability | `HKSTPIdentityRegistry` — 6 claim topics + ONCHAINID identity verification |
| Transfer restrictions | `HKSTPCompliance` — jurisdiction, lock-up, concentration caps |
| Multi-oracle attestation | `OracleCommittee` — threshold-based multi-sig for compliance approvals |
| **Order book KYC gate** | `OrderBook` — `identityRegistry.isVerified()` enforced on every buy/sell order; non-KYC wallets cannot trade even via MetaMask |
| **Multi-market trading** | `OrderBookFactory` — one order book per listed security token; admin-managed market lifecycle |
| Settlement finality | `DvPSettlement` — atomic single-transaction, immutable audit trail |
| Emergency intervention | `pause()` on token, DvP, OrderBook, and WalletRegistry (PAUSER_ROLE / DEFAULT_ADMIN_ROLE) |
| Audit trail | Events on every state change across all contracts |
| Custody safeguards | `WalletRegistry` (98/2 enforcement) + `MultiSigWarm` (2-of-3 warm wallet) |
| Cold storage compliance | Air-gapped signing, FIPS 140-2 Level 3+ HSM, key ceremony quorum controls |
| Forced transfer / rectification | `forcedTransfer()` (EIP-1644) with IPFS-anchored legal proof |
| Shareholder cap | 50-shareholder limit enforced via identity-linked compliance module |
| Governance transparency | `HKSTPGovernor` + `HKSTPTimelock` — KYC-gated voting, 48-hour execution delay |
| Supply-cap & tiered minting | `maxSupply` hard cap + `mintThreshold` governance gate — prevents unlimited inflation; large issuances require Governor proposal + 48 h Timelock |
| Self-dealing prevention | `mint()` and `forcedTransfer()` enforce `to != msg.sender` — operators cannot issue or redirect tokens to themselves |
| Deposit / Withdrawal | FPS integration with closed-loop AML; future Project Ensemble / wCBDC support |

---

## 12  Citation List

1. Project Plan - Tokenizing HKSTP Startups v0.2.pdf
2. [SFC Circular on Tokenisation (2 Nov 2023)](https://apps.sfc.hk/edistributionWeb/api/circular/list-content/circular/doc?lang=EN&refNo=23EC53)
3. [What is ERC-3643? | Quicknode](https://www.quicknode.com/guides/real-world-assets/erc-3643)
4. [ERC-3643 Permissioned Tokens](https://docs.erc3643.org/erc-3643)
5. [Three Tokenization Forces | SettleMint](https://www.settlemint.com/blog/three-tokenization-forces-defining-the-future-of-financial-markets)
6. [ERC-3643 Smart Contracts (GitHub)](https://github.com/ERC-3643/ERC-3643)
7. [ERC-3643 Standard](https://www.erc3643.org/)
8. [How to Tokenize Real Estate | Medium](https://medium.com/@velvosoft/how-to-tokenize-real-estate-technical-implementation-guide-571933535d62)
9. [ERC-1644 Issue](https://github.com/ethereum/EIPs/issues/1644)
10. [ERC-1400 Guide | Primior](https://primior.com/how-erc-1400-works-a-complete-guide-to-the-security-token-standard/)
11. [ERC-1400 & 1410](https://ethereum-magicians.org/t/erc-1400-and-erc-1410-security-token-and-partially-fungible-token/1314)
12. [OpenZeppelin RWA Docs](https://docs.openzeppelin.com/stellar-contracts/tokens/rwa/rwa)
13. [ERC-3643 Explained | QuillAudits](https://www.quillaudits.com/blog/rwa/erc-3643-explained)
14. [Tokeny ERC-3643](https://tokeny.com/erc3643/)
15. [Merkle Science ERC-3643](https://www.merklescience.com/erc-3643-unveiling-the-future-of-financial-compliance-in-security-token-contracts)
16. [Chainlink Atomic Settlement](https://chain.link/article/atomic-settlement-onchain-dvp)
17. [Blockchain Council Atomic Settlement](https://www.blockchain-council.org/blockchain/atomic-settlement-in-blockchain/)
18. [BondbloX Atomic Settlement](https://bondblox.com/all-featured-articles/the-alchemy-of-atomic-settlement)
19. [Visa e-HKD Report](https://corporate.visa.com/content/dam/VCOM/regional/na/us/Solutions/documents/e-hkd-and-the-future-of-global-money-movement.pdf)
20. [OpenZeppelin Governance Docs](https://docs.openzeppelin.com/contracts/5.x/api/governance)
21. [Tally Governor Docs](https://docs.tally.xyz/user-guides/governance-frameworks/openzeppelin-governor)
22. [SettleMint ERC-3643 Guide](https://www.settlemint.com/blog/guide-writing-deploying-erc-3643-smart-contract-with-settlemint)
23. [Tally DAO Guide](https://docs.tally.xyz/user-guides/dao-best-practices/running-an-onchain-dao-using-openzeppelin-governor)
24. [OpenZeppelin Governance (v4)](https://docs.openzeppelin.com/contracts/4.x/api/governance)
25. [Lightspark FPS Overview](https://www.lightspark.com/knowledge/hong-kong-instant-payments)
26. [HKMA Project Ensemble (2025)](https://www.hkma.gov.hk/eng/news-and-media/press-releases/2025/11/20251113-3/)
27. [HKMA FPS](https://www.hkma.gov.hk/eng/smart-consumers/faster-payment-system/)
28. [HSBC Developer Portal](https://develop.hsbc.com/api-overview/how-get-started-21)
29. [Aspire FPS Guide](https://aspireapp.com/hk/blog/set-up-business-fps)
30. [Hong Kong FPS QR | ECOMMPAY](https://developers.ecommpay.com/en/pm_hk_qr.html)
31. [eftPay HK Gateway](https://www.eftpay.com.hk/en/merchant-business-electronic-payment-solution/)
32. [HKICL FPS Offers](https://fps.hkicl.com.hk/eng/fps/about_fps/what_fps_offers.php)
33. [HKMA Project Ensemble (2024)](https://www.hkma.gov.hk/eng/news-and-media/press-releases/2024/03/20240307-5/)
34. [e-HKD Pilot Phase 2 Report](https://www.hkma.gov.hk/media/eng/doc/key-functions/financial-infrastructure/e-HKD_Pilot_Programme_Phase_2_Report.pdf)
35. [J.P. Morgan Deposit Tokens](https://www.jpmorgan.com/kinexys/documents/deposit-tokens.pdf)
36. [Elliptic HKMA Tokenization](https://www.elliptic.co/blog/crypto-regulatory-affairs-hkma-tokenization-pilot-program-begins)
37. [HKMA Ensemble Sandbox](https://www.hkma.gov.hk/eng/news-and-media/press-releases/2024/08/20240828-3/)
38. [Sidley Tokenization Buzz 2024](https://www.sidley.com/en/insights/newsupdates/2024/08/hong-kong-tokenization-buzz-2024-tokenized-real-world-assets-x-tokenized-deposits)
39. [KPMG SFC Expectations](https://assets.kpmg.com/content/dam/kpmgsites/cn/pdf/en/2023/11/sfc-outlines-its-expectations-on-tokenised-products-and-services.pdf.coredownload.inline.pdf)
