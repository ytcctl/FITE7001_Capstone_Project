# TokenHub Smart Contracts

> Permissioned security token platform integrated with Hong Kong Science & Technology Parks (HKSTP) for fractional equity tokenization, ONCHAINID identity management, tiered custody, on-chain governance, and atomic DvP settlement.

---

## Architecture Overview

TokenHub operates on a **Hyperledger Besu** permissioned network (EVM-compatible) with four validator nodes — HKSTP, Platform Operator, Licensed Custodian, and Regulator Observer.

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
│                  HYPERLEDGER BESU  (Permissioned EVM)                    │
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
| **Claim Topics Registry** | List of required verifications (5 topics) | Specifies required claims (e.g., PI status) |

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
| 2 | Accredited Investor |
| 3 | Jurisdiction Approved (HK / non-sanctioned) |
| 4 | Source of Funds Verified |
| 5 | PEP / Sanctions Clear |

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

## 6  Project Structure

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

scripts/
├── deploy.js                     # Core deployment logic (5 core contracts + roles)
├── deploy-besu.js                # Unified launcher: block-producer + deploy.js in one command
├── deploy-and-update-frontend.js # Deploy + write ABI/addresses to frontend (Codespaces)
├── deploy-health-check.js        # Deploy & run SystemHealthCheck
├── deploy-orderbook.js           # Deploy standalone OrderBook (embedded block producer)
├── deploy-orderbook-factory.js   # Deploy OrderBookFactory + initial HKSTP market
├── seed-investor.js              # Seed test investor identities
├── harden-admin.js               # Post-deploy admin hardening
└── burn-excess.js                # Burn excess token supply

besu/
├── block-producer.js             # Engine API V3 block forger for post-merge Besu
├── genesis.json                  # Besu genesis config (Cancun EVM, runtime chain ID 31337)
├── start-besu.ps1                # Start Besu Docker container (Windows PowerShell)
├── start-besu.sh                 # Start Besu Docker container (Linux / Codespaces)
├── ibft/                         # IBFT2 validator key material
└── data/                         # Besu runtime data (git-ignored)

.devcontainer/
├── devcontainer.json             # GitHub Codespaces / VS Code Dev Container config
└── post-create.sh                # Auto-setup: install, compile, deploy, start frontend

frontend/
├── src/
│   ├── App.tsx                   # Route definitions + wrong-network banner
│   ├── main.tsx                  # Entry point
│   ├── components/
│   │   └── Layout.tsx            # Navigation sidebar + Connect Wallet dropdown
│   ├── config/
│   │   └── contracts.ts          # Contract addresses + ABIs
│   ├── context/
│   │   └── Web3Context.tsx       # MetaMask / private-key provider + contract instances
│   └── pages/
│       ├── Dashboard.tsx         # Platform overview
│       ├── Trading.tsx           # Multi-market order book trading (KYC-gated, last price + 24h change)
│       ├── MarketManagement.tsx  # Admin: create/manage order book markets
│       ├── Portfolio.tsx         # Token portfolio view
│       ├── Settlement.tsx        # DvP settlement management
│       ├── KYCManagement.tsx     # Identity & KYC claim management
│       ├── TokenManagement.tsx   # Token lifecycle management
│       ├── TokenMinting.tsx      # Mint/burn security tokens
│       ├── ComplianceRules.tsx   # Compliance module configuration
│       ├── Governance.tsx        # On-chain governance proposals
│       └── WalletCustody.tsx     # Hot/warm/cold wallet management
└── ...

test/
├── HKSTPSecurityToken.test.js    # Token deployment, mint, transfer, pause, freeze, supply cap, tiered minting, self-dealing prevention
├── HKSTPCompliance.test.js       # Attestation, replay, module checks
├── DvPSettlement.test.js         # Settlement lifecycle, atomic execution
├── Identity.test.js              # ONCHAINID deployment + claim management
├── OracleCommittee.test.js       # Multi-oracle threshold attestation
├── TokenFactory.test.js          # Factory deployment + lifecycle
├── Governance.test.js            # Governor + Timelock voting flow
├── WalletArchitecture.test.js    # Custody tiers + 98/2 ratio enforcement
├── ShareholderCap.test.js        # 50-shareholder cap enforcement
├── AML.test.js                   # AML/KYC compliance scenarios
├── ActionPlan.test.js            # End-to-end action plan scenarios
└── integration/
    └── besu-e2e.test.js          # Hyperledger Besu end-to-end tests
```

---

## 7  Setup & Installation

### Option A — GitHub Codespaces (One-Click)

The fastest way to get a running instance with zero local setup:

1. Go to [github.com/ytcctl/FITE7001_Capstone_Project](https://github.com/ytcctl/FITE7001_Capstone_Project)
2. Click **Code → Codespaces → Create codespace on main**
3. Wait ~3 minutes — the `postCreateCommand` (`.devcontainer/post-create.sh`) automatically:
   - Installs all Node dependencies (`npm ci` for root + frontend)
   - Compiles Solidity contracts
   - Starts **Hardhat Network** in background (chain ID 31337, auto-mine)
   - Deploys all 12+ contracts via `deploy-and-update-frontend.js`
   - Deploys OrderBook
   - Seeds Investor1 (KYC + tokens) *(optional, may be skipped)*
   - Auto-updates `frontend/src/config/contracts.ts` with deployed addresses
   - Launches the Vite frontend on port 3000
4. Codespaces auto-forwards port 3000 — click the URL to open the frontend
5. Use the **built-in test accounts** in the Connect Wallet dropdown (no MetaMask needed), or import a dev key in MetaMask

| Port | Service |
|------|---------|
| 3000 | Frontend (Vite) — auto-opens in browser |
| 8545 | Hardhat JSON-RPC |

> **MetaMask in Codespaces:** Point MetaMask to the Codespaces-forwarded port 8545 URL (e.g. `https://<codespace>-8545.app.github.dev`), chain ID **31337**. Alternatively, use the built-in wallet (paste a dev private key directly in the Connect Wallet dropdown).

### Option B — Local Setup

#### Prerequisites
- Node.js ≥ 18 (required by Hardhat ^2.22.4)
- npm ≥ 9
- Docker *(optional — only needed if using Hyperledger Besu instead of Hardhat Network)*

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
| `npm run test:besu` | `hardhat test test/integration/besu-e2e.test.js --network besu` | Besu end-to-end integration tests *(optional)* |
| `npm run coverage` | `hardhat coverage` | Solidity code coverage report |
| `npm run deploy:local` | `hardhat run scripts/deploy.js --network localhost` | Deploy core contracts to Hardhat node |
| `npm run deploy:besu` | `node scripts/deploy-besu.js` | **Unified deploy** — auto-spawns Hardhat node + deploys all contracts |
| `npm run deploy:besu:raw` | `hardhat run scripts/deploy.js --network besu` | Deploy to Besu *(requires running Besu + block producer)* |
| `npm run besu:start` | `powershell … start-besu.ps1 -Detach` | Start Besu Docker container *(optional)* |
| `npm run besu:stop` | `docker stop/rm tokenhub-besu` | Stop & remove Besu container *(optional)* |
| `npm run besu:logs` | `docker logs -f tokenhub-besu` | Tail Besu container logs *(optional)* |
| `npm run clean` | `hardhat clean` | Remove artifacts & cache |

> **Recommended for development:** Use `npx hardhat node` + `--network localhost` (Hardhat Network). Besu scripts are available for production-like testing but require Docker.

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
npm run compile

# Terminal 1 — start Hardhat node (stays running)
npx hardhat node

# Terminal 2 — deploy all 14 contracts + configure roles + seed Investor1 + auto-update frontend
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost
```

`scripts/deploy-and-update-frontend.js` performs the following in a single run:
1. Deploys all **14 contracts**: IdentityRegistry, Compliance, SecurityToken, MockCashToken, DvPSettlement, TokenFactory, ClaimIssuer, IdentityFactory, Timelock, Governor, WalletRegistry, MultiSigWarm, **OrderBook**, SystemHealthCheck
2. Configures all roles: TOKEN_ROLE, OPERATOR_ROLE, AGENT_ROLE, DEPLOYER_ROLE, PROPOSER_ROLE, EXECUTOR_ROLE, CANCELLER_ROLE
3. Safe-lists: Treasury, Escrow, WalletRegistry, MultiSigWarm, **OrderBook** on the SecurityToken
4. Wires ONCHAINID: IdentityFactory → IdentityRegistry, ClaimIssuer as Trusted Issuer
5. Wires Governance: Governor → Timelock, Timelock → SecurityToken admin
6. Wires Custody: WalletRegistry tracks SecurityToken + CashToken, MultiSigWarm registered as WARM wallet
7. Sets Cap. 622 shareholder cap (50)
8. **Seeds Investor1** (`0x5e33E2E5333DD9b7b428AC38AE361E9b707046f3`): registers identity, sets KYC claims (1–5), issues ERC-735 claims, mints 10,000 HKSAT + 5,000,000 THKD
9. **Auto-updates** `frontend/src/config/contracts.ts` with all deployed addresses (including OrderBook)

> **No manual address updates needed** — the script writes all 13 contract addresses directly into the frontend config file.

#### Alternative: Unified Launcher

```bash
npm run deploy:besu    # Auto-spawns Hardhat node + deploys core contracts
```

`npm run deploy:besu` runs `scripts/deploy-besu.js` which auto-detects whether a node is running and spawns one if needed. Note: this deploys only the 5 core contracts; for the full 14-contract deployment, use `deploy-and-update-frontend.js` above.

#### Manual Start (Step-by-Step)

```bash
# Terminal 1 — start the Hardhat node (stays running)
npx hardhat node

# Terminal 2 — deploy everything (14 contracts + seed + auto-update)
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

# Terminal 2 — start the frontend
cd frontend && npm run dev
```

#### Dev Accounts (pre-funded with 1,000,000 ETH each)

These addresses are **deterministic** — they are identical on every fresh Hardhat Network launch.

| Role | Address | Private Key |
|------|---------|-------------|
| Deployer / Admin | `0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73` | `0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63` |
| Operator | `0x627306090abaB3A6e1400e9345bC60c78a8BEf57` | `0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3` |
| Agent / Custodian | `0xf17f52151EbEF6C7334FAD080c5704D77216b732` | `0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f` |
| Seller | `0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef` | `0x0dbbe8e4ae425a6d2687f1a7e3ba17bc98c6736950282febeaea2cf4c0f57ecb` |
| Buyer | `0x821aEa9a577a9b44299B9c15c88cf3087F3b5544` | `0xc88b703fb08cbea894b6aeff5a544fb92e78a18e19814cd85da83b71f772aa6c` |

#### Seeded Investor Account (auto-provisioned by deploy script)

The unified deploy script (`deploy-and-update-frontend.js`) automatically seeds this investor after contract deployment:

| Role | Address | Private Key |
|------|---------|-------------|
| Investor1 | `0x5e33E2E5333DD9b7b428AC38AE361E9b707046f3` | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a` |

**Investor1 seeded state** (after deploy):
- ✅ Identity registered in `HKSTPIdentityRegistry` (country: HK)
- ✅ KYC claims verified (topics 1–5: AML, CFT, CDD, Accredited Investor, Domicile)
- ✅ ERC-735 on-chain claims signed by `ClaimIssuer`
- ✅ **10,000 HKSAT** (security tokens) minted
- ✅ **5,000,000 THKD** (test HKD cash tokens) minted
- ✅ Pre-funded with 1,000,000 ETH (Hardhat genesis)

> **⚠️ Warning:** All keys above are well-known dev keys — **never** use them on a public network.

### Hyperledger Besu Network (Optional — Production-like)

Besu is available as an alternative for production-like testing with the Engine API block producer.

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

#### One-Command Deploy (Recommended)

The unified launcher spawns the Engine-API block producer as a child process, deploys all 5 core contracts, configures roles, then cleans up automatically:

```bash
# 1. Start the Besu container (if not already running)
npm run besu:start
# or: .\besu\start-besu.ps1 -Detach

# 2. Compile contracts
npm run compile

# 3. Deploy everything in one go
npm run deploy:besu
```

`npm run deploy:besu` runs `scripts/deploy-besu.js` which:
1. Checks if a node is running on port 8545 (Hardhat or Besu)
2. If not, auto-spawns `npx hardhat node` as a managed child process
3. If Besu Engine API is detected on port 8551, spawns the block producer
4. Runs `npx hardhat run scripts/deploy.js --network localhost`
5. Stops the block producer (if any) and leaves the node running

> **Why a unified script?** It auto-detects whether to use Hardhat Network (auto-mine) or Besu (Engine API block production), handles spawning the node if needed, and coordinates everything in a single process.

#### Manual Deploy (Advanced)

If you prefer to run the block producer separately:

```bash
# Terminal 1 — start the block producer
node besu/block-producer.js --interval 1000

# Terminal 2 — deploy contracts
npx hardhat run scripts/deploy.js --network besu
```

#### Deploy OrderBook (After Core Contracts)

```bash
# Deploy standalone OrderBook with embedded block producer
npx hardhat run scripts/deploy-orderbook.js --network besu

# Deploy OrderBookFactory + initial market
npx hardhat run scripts/deploy-orderbook-factory.js --network besu
```

### Deployment Order (`deploy-and-update-frontend.js`)

| # | Contract | Purpose |
|---|----------|---------|
| 1 | **HKSTPIdentityRegistry** | KYC/AML claim storage, ONCHAINID wiring |
| 2 | **HKSTPCompliance** | Attestation + module enforcement |
| 3 | **HKSTPSecurityToken** | ERC-3643 security token (linked to registry + compliance) |
| 4 | **MockCashToken** | Tokenized HKD (replace with Project Ensemble contract in production) |
| 5 | **DvPSettlement** | Atomic settlement engine |
| 6 | **TokenFactory** | Deploy multiple startup tokens via cloning |
| 7 | **ClaimIssuer** | Trusted Claim Issuer for ONCHAINID ERC-735 claims |
| 8 | **IdentityFactory** | ONCHAINID minimal proxy factory |
| 9 | **HKSTPTimelock** | Governance execution delay (48 h) |
| 10 | **HKSTPGovernor** | On-chain governance with KYC-gated voting |
| 11 | **WalletRegistry** | Custody tier registry + 98/2 enforcement |
| 12 | **MultiSigWarm** | 2-of-3 warm wallet multi-sig |
| 13 | **OrderBook** | On-chain order book (HKSAT/THKD, KYC-gated) |
| 14 | **SystemHealthCheck** | Post-deployment wiring verification (optional) |

After deployment, the script also:
- Configures all roles and safe-lists
- Seeds **Investor1** with identity, KYC claims, 10,000 HKSAT + 5,000,000 THKD
- Auto-updates `frontend/src/config/contracts.ts`

### Post-Deployment Steps

1. Grant `TOKEN_ROLE` on `HKSTPCompliance` to `HKSTPSecurityToken`
2. Grant `AGENT_ROLE` on `HKSTPSecurityToken` to licensed custodian wallets
3. Safe-list treasury, escrow, and custody addresses on the token
4. Set `maxSupply` on `HKSTPSecurityToken` (hard cap on total supply)
5. Set `mintThreshold` on `HKSTPSecurityToken` (e.g. 1 % of supply) and grant `TIMELOCK_MINTER_ROLE` to `HKSTPTimelock`
6. Grant `OPERATOR_ROLE` on `DvPSettlement` to the matching engine service account
7. Register oracle members on `OracleCommittee` and set threshold
8. Register investor identities via `IdentityFactory.deployIdentity()` + `HKSTPIdentityRegistry.registerIdentity()`
9. Set KYC claims via `HKSTPIdentityRegistry.setClaim()`
10. Create initial order book markets via `OrderBookFactory.createOrderBook()` (one per listed token)
11. Safe-list each deployed OrderBook on its corresponding security token (`setSafeList(orderBookAddr, true)`)
12. Register wallet tiers in `WalletRegistry` (hot, warm, cold)
13. Configure `MultiSigWarm` signers
14. Grant `PROPOSER_ROLE` / `EXECUTOR_ROLE` on `HKSTPTimelock` to `HKSTPGovernor`
15. Run `SystemHealthCheck.fullHealthCheck()` to verify all wiring
16. Run `scripts/harden-admin.js` to finalize admin role configuration

---

## 10  Frontend Deployment

The Investor Portal is a **React 18 + Vite + Tailwind CSS** single-page application located in `frontend/`.

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 18 |
| Blockchain node | Running (`npx hardhat node` or Besu container) |
| Contracts deployed | Via `npm run deploy:besu` or `npx hardhat run scripts/deploy-and-update-frontend.js --network localhost` (see §9) |
| MetaMask | *(Optional)* — configured for Chain ID **31337**; you can also use the built-in wallet |

### Step 1 — Contract Addresses (Auto-Updated)

When you deploy via `deploy-and-update-frontend.js`, it **automatically writes** all contract addresses into `frontend/src/config/contracts.ts` — no manual editing required.

If you used a different deploy script, or need to update manually, edit the file with addresses from the deployment output:

```typescript
// frontend/src/config/contracts.ts
export const CONTRACT_ADDRESSES = {
  identityRegistry: '0x...', // from deploy output
  compliance:       '0x...',
  securityToken:    '0x...',
  cashToken:        '0x...',
  dvpSettlement:    '0x...',
  tokenFactory:     '0x...',
  claimIssuer:      '0x...',
  identityFactory:  '0x...',
  timelock:         '0x...',
  governor:         '0x...',
  walletRegistry:   '0x...',
  multiSigWarm:     '0x...',
  orderBook:        '0x...',
};
```

### Step 2 — Install Dependencies

```bash
cd frontend
npm install
```

### Step 3 — Start Dev Server

```bash
npm run dev
# → opens http://localhost:3000
```

### Step 4 — Connect Wallet

#### Option A — Built-in Test Accounts (Recommended, No MetaMask)

1. Click **Connect Wallet** in the sidebar
2. Select a test account from the dropdown:

| Account | Role | Address |
|---------|------|---------|
| Deployer / Admin | `DEFAULT_ADMIN_ROLE` | `0xFE3B…Bd73` |
| Operator | `OPERATOR_ROLE` | `0x6273…Ef57` |
| Agent / Custodian | `AGENT_ROLE` | `0xf17f…b732` |
| Seller | Investor | `0xC5fd…8Fef` |
| Buyer | Investor | `0x821a…5544` |

3. You're connected — no browser extension required

#### Option B — MetaMask

1. Add a **Custom Network** in MetaMask:
   - **Network Name:** TokenHub Devnet
   - **RPC URL:** `http://127.0.0.1:8545`
   - **Chain ID:** `31337`
   - **Currency Symbol:** ETH
2. **Import** a dev account private key (e.g. the deployer key from the table in §9)
3. Connect to the dApp when prompted

> ⚠️ **Nonce errors after restarting Hardhat node:** MetaMask → Settings → Advanced → **Clear activity tab data**

### Step 5 — Production Build (Optional)

```bash
cd frontend
npm run build     # outputs to frontend/dist/
npm run preview   # preview production build locally
```

The `dist/` folder can be served by any static hosting provider (Nginx, Vercel, Netlify, GitHub Pages, etc.).

### Frontend Port Reference

| Port | Service |
|------|---------|
| 3000 | Frontend (Vite dev server) |
| 8545 | Hardhat / Besu JSON-RPC |
| 8546 | Besu WebSocket *(Besu only — not needed with Hardhat)* |
| 8551 | Besu Engine API *(Besu only — not needed with Hardhat)* |

### Sharing the Portal with Teammates for Testing

If you need to let teammates access the running frontend without cloning the repo or installing anything locally, choose one of the options below.

#### Option 1 — GitHub Codespaces (Recommended)

Codespaces is the simplest approach — teammates only need a **web browser** and optionally **MetaMask**.

**Setup (person who created the Codespace):**

```bash
# 1. Inside the Codespace terminal — start the blockchain
npx hardhat node &

# 2. Deploy all contracts + auto-update frontend addresses
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

# 3. Start the frontend
cd frontend && npm run dev
```

**Make ports public** so teammates can reach them:

1. Open the **Ports** tab in Codespaces (bottom panel)
2. Right-click port **3000** → **Port Visibility → Public**
3. Right-click port **8545** → **Port Visibility → Public**
4. Copy the forwarded URL for port 3000 (e.g. `https://<codespace>-3000.app.github.dev`)
5. Share both URLs with your teammates

**Teammate access (no GitHub Codespaces account required):**

| What they need | Details |
|----------------|---------|
| Web browser | Open the shared port-3000 URL |
| MetaMask *(optional)* | Add custom network → RPC URL = shared port-8545 URL, Chain ID = **31337** |
| Built-in wallet | Teammates can also use the built-in Connect Wallet dropdown (select a test account or paste a dev private key) — **no MetaMask required** |

> **Note:** The shared port-3000 URL serves the full frontend; the port-8545 URL serves the Hardhat JSON-RPC endpoint. Both must be set to **Public** visibility.

#### Option 2 — Vercel / Netlify (Frontend Only)

Deploy the static frontend to a free hosting service. The teammate's browser still needs access to a running blockchain node.

```bash
cd frontend
npm run build          # outputs to frontend/dist/
# Deploy dist/ to Vercel, Netlify, or GitHub Pages
```

| Pros | Cons |
|------|------|
| Persistent public URL | Frontend only — the blockchain node must still be accessible |
| Free tier available | Need to expose port 8545 separately (e.g. via Codespaces or ngrok) |
| CDN-backed, fast globally | Each redeploy after contract changes requires rebuilding |

> Update `frontend/src/config/contracts.ts` with the publicly accessible RPC URL before building.

#### Option 3 — ngrok (Tunnel from Local Machine)

Expose your local dev server to the internet via a secure tunnel.

```bash
# Terminal 1 — local Hardhat node (already running)
npx hardhat node

# Terminal 2 — tunnel the frontend
npx ngrok http 3000

# Terminal 3 — tunnel the blockchain RPC
npx ngrok http 8545
```

Share the ngrok URLs with teammates. They open the frontend URL in a browser and point MetaMask to the RPC URL.

| Pros | Cons |
|------|------|
| Works from any local machine | Free tier: random URL changes on restart |
| No deployment needed | Requires ngrok account for multiple tunnels |
| Tunnels both frontend + RPC | Slower than Codespaces (traffic routed through ngrok) |

#### Option 4 — Public Testnet (Sepolia / Amoy)

Deploy contracts to a public EVM testnet for persistent shared access.

| Pros | Cons |
|------|------|
| Persistent — survives restarts | Requires testnet ETH (faucets) |
| Closest to production | Slower block times (~12 s on Sepolia) |
| No tunneling or port forwarding | Deploying 14 contracts takes longer |

> This option is best for final integration testing, not day-to-day development.

#### Comparison Summary

| Option | Setup Time | Teammate Requirements | Persistence | Best For |
|--------|-----------|----------------------|-------------|----------|
| **Codespaces** | ~3 min | Browser only | While Codespace is running | Day-to-day team testing ✅ |
| **Vercel / Netlify** | ~10 min | Browser + RPC access | Permanent (frontend) | Demo / presentation |
| **ngrok** | ~2 min | Browser + MetaMask | While tunnel is open | Quick ad-hoc sharing |
| **Public Testnet** | ~30 min | Browser + MetaMask + testnet ETH | Permanent | Final integration testing |

---

## 11  Role-Based Access Control (RBAC)

The frontend enforces four role tiers. Roles are detected automatically from on-chain `AccessControl` state when a wallet connects.

### Role Detection

| Role | Badge | On-Chain Check |
|------|-------|---------------|
| **Admin** | 🟡 Yellow | `DEFAULT_ADMIN_ROLE` on `IdentityRegistry` |
| **Agent / Custodian** | 🟠 Orange | `AGENT_ROLE` on `IdentityRegistry` |
| **Operator** | 🟢 Green | `OPERATOR_ROLE` on `DvPSettlement` |
| **Investor** | 🔵 Blue | Default (no privileged role) |

### Page Access Matrix

| Page | Route | Admin | Agent | Operator | Investor |
|------|-------|:-----:|:-----:|:--------:|:--------:|
| Dashboard | `/` | ✅ | ✅ | ✅ | ✅ |
| Trading | `/trading` | ✅ | ✅ | ✅ | ✅ |
| Portfolio | `/portfolio` | ✅ | ✅ | ✅ | ✅ |
| Governance | `/governance` | ✅ | ✅ | ✅ | ✅ |
| DvP Settlement | `/settlement` | ✅ | ✅ | ✅ | ✅ |
| KYC Management | `/kyc` | ✅ | ✅ | ❌ | ❌ |
| Token Minting | `/mint` | ✅ | ✅ | ❌ | ❌ |
| Oracle Committee | `/oracle` | ✅ | ✅ | ✅ | ❌ |
| Compliance Rules | `/compliance` | ✅ | ❌ | ❌ | ❌ |
| Token Management | `/tokens` | ✅ | ❌ | ❌ | ❌ |
| Market Management | `/markets` | ✅ | ❌ | ❌ | ❌ |
| Wallet Custody | `/custody` | ✅ | ❌ | ❌ | ❌ |

### Route Guards (App.tsx)

| Guard | Roles Allowed | Protected Routes |
|-------|--------------|-----------------|
| `AdminOnlyRoute` | Admin | `/compliance`, `/tokens`, `/markets`, `/custody` |
| `AdminRoute` | Admin + Agent | `/kyc`, `/mint` |
| `PrivilegedRoute` | Admin + Agent + Operator | `/oracle` |
| *(none)* | All authenticated | `/`, `/trading`, `/portfolio`, `/governance`, `/settlement` |

### Start-Up Company Access

Start-up companies listed on the HKSTP TokenHub platform are **Investor**-role users. They do not need any special on-chain role or admin access. Their interactions include:

- **Dashboard** — view platform overview and token metrics
- **Trading** — buy/sell security tokens on the order book (KYC required)
- **Portfolio** — view their token holdings
- **Governance** — vote on proposals (token-weighted, KYC-gated)
- **DvP Settlement** — participate in atomic delivery-vs-payment settlements

All administrative functions (KYC management, token issuance, compliance configuration, custody operations) are managed by HKSTP administrators on behalf of the start-up companies.

---

## 12  Security Considerations

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

## 13  SFC Regulatory Alignment

| Requirement | Implementation |
|-------------|----------------|
| Investor suitability | `HKSTPIdentityRegistry` — 5 claim topics + ONCHAINID identity verification |
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

## 14  Comparable Platforms in the Market

Several platforms offer overlapping capabilities for security token issuance and management. The table below compares TokenHub against the most relevant industry players.

### 14.1  Securitize

| Feature | Securitize | TokenHub HKSTP |
|---------|-----------|----------------|
| Token Standard | DS Protocol (proprietary) | ERC-3643 / T-REX (open standard) |
| KYC/AML | Built-in KYC provider (off-chain) | On-chain ERC-735 claims via ONCHAINID |
| Compliance | Off-chain + on-chain rules | Fully on-chain (jurisdiction, caps, lock-up) |
| Trading | Securitize Markets (licensed ATS) | On-chain CLOB (Central Limit Order Book) |
| Settlement | T+2 traditional | Atomic DvP (instant, single-transaction) |
| Governance | None built-in | On-chain Governor + Timelock (48 h delay) |
| Custody | Partnered (BitGo, Fireblocks) | Built-in 98/2 rule with multi-sig warm wallet |
| Target Market | US regulated securities | Hong Kong SFC-aligned startups |

### 14.2  Tokeny (T-REX Protocol)

| Feature | Tokeny | TokenHub HKSTP |
|---------|--------|----------------|
| Token Standard | ERC-3643 T-REX | ERC-3643 (same standard) |
| Identity | ONCHAINID | ONCHAINID (same) |
| Compliance | Modular compliance modules | Similar modular approach + EIP-712 attestation |
| Trading | No built-in exchange | Full CLOB order book with KYC gate |
| Settlement | No DvP engine | Atomic DvP with Travel Rule support |
| Governance | None | Governor + Timelock |
| Custody | None | 98/2 hot/warm/cold tiers + multi-sig |
| Oracle | Single trusted issuer | Multi-sig oracle committee (threshold-based) |

> **TokenHub is closest to Tokeny** since both use ERC-3643 + ONCHAINID, but TokenHub adds trading, settlement, governance, and custody layers that Tokeny does not provide.

### 14.3  Polymath / Polymesh

| Feature | Polymesh | TokenHub HKSTP |
|---------|----------|----------------|
| Blockchain | Polymesh (custom L1 chain) | EVM-compatible (Hardhat / Besu / any EVM) |
| Token Standard | Proprietary (Polymesh-native) | ERC-3643 (Ethereum standard) |
| KYC | CDD (Customer Due Diligence) providers | On-chain ONCHAINID ERC-735 claims |
| Compliance | Built into chain layer | Smart contract modules (portable across EVM chains) |
| Trading | Venue-based matching | On-chain CLOB |
| Settlement | Built-in settlement | Atomic DvP (single transaction) |
| Governance | PIP (Polymesh Improvement Proposals) | OpenZeppelin Governor + Timelock |
| Portability | Locked to Polymesh chain | Any EVM chain (Ethereum, Polygon, Arbitrum, etc.) |

### 14.4  Fireblocks

| Feature | Fireblocks | TokenHub HKSTP |
|---------|-----------|----------------|
| Focus | Custody + infrastructure | Full-stack STO platform |
| Custody | MPC (Multi-Party Computation) | On-chain multi-sig + 98/2 rule enforcement |
| Token Issuance | Via partner integrations | Built-in TokenFactory + V2 upgradeable proxy |
| Trading | Via exchange integrations | Native on-chain CLOB |
| KYC | Via partner integrations | Native on-chain identity (ONCHAINID) |

### 14.5  InvestaX (Asia-Focused, Singapore)

| Feature | InvestaX (SG) | TokenHub HKSTP |
|---------|--------------|----------------|
| Jurisdiction | MAS (Singapore) | HK SFC |
| Token Standard | Proprietary | ERC-3643 (open standard) |
| Trading | OTC-style matching | On-chain CLOB with three-layer KYC gate |
| Settlement | Custodian-mediated | Atomic DvP (trustless, single-transaction) |
| Open Source | No | Yes (full stack) |

### 14.6  Feature Comparison Matrix

```
                    Securitize  Tokeny  Polymesh  Fireblocks  TokenHub
                    ─────────   ──────  ────────  ──────────  ────────
ERC-3643 Token         ✗         ✓        ✗         ✗          ✓
On-chain Identity      ✗         ✓        ✓         ✗          ✓
On-chain Compliance    △         ✓        ✓         ✗          ✓
On-chain CLOB          ✗         ✗        △         ✗          ✓
Atomic DvP             ✗         ✗        ✓         ✗          ✓
On-chain Governance    ✗         ✗        ✓         ✗          ✓
Built-in Custody       ✗         ✗        ✗         ✓          ✓
Upgradeable Tokens     ✗         ✗        ✗         ✗          ✓
Multi-sig Oracle       ✗         ✗        ✗         ✗          ✓
Open Source            ✗         △        ✓         ✗          ✓
HK SFC Specific        ✗         ✗        ✗         ✗          ✓

✓ = native    △ = partial    ✗ = not available
```

---

## 15  TokenHub Advantages

### 15.1  Full-Stack On-Chain Architecture

Most STO platforms split logic between off-chain servers and on-chain contracts. TokenHub keeps **everything on-chain**, eliminating single points of failure and off-chain trust assumptions.

| Layer | On-Chain Component |
|-------|-------------------|
| Identity | ONCHAINID + ERC-735 claims |
| Compliance | Jurisdiction, caps, lock-up in smart contracts |
| Trading | Central Limit Order Book (CLOB) |
| Settlement | Atomic DvP (single-transaction swap) |
| Custody | 98/2 rule + multi-sig warm wallet |
| Governance | Governor + Timelock |

### 15.2  Atomic Delivery-vs-Payment (DvP)

Traditional settlement takes T+1 or T+2 (1–2 business days). TokenHub settles in **one transaction** — buyer cash and seller tokens swap atomically in the same block, eliminating counterparty risk and settlement delay entirely.

### 15.3  ERC-3643 Open Standard (EVM Portability)

TokenHub uses the ERC-3643 standard (adopted by Tokeny, recognized by the Ethereum community) rather than proprietary token formats. Tokens can migrate to Ethereum, Polygon, Arbitrum, or any EVM chain without re-issuance — no vendor lock-in.

### 15.4  Four-Tier RBAC with Least Privilege

TokenHub enforces segregation of duties across 4 role tiers (Admin, Agent, Operator, Investor) with 22 negative route-guard test cases. A KYC agent cannot create tokens; an operator cannot freeze accounts. This aligns with HK SFC's internal control requirements.

### 15.5  Multi-Sig Oracle Committee

Instead of trusting a single compliance oracle, TokenHub requires **threshold-based multi-oracle attestation** (e.g. 2-of-3). Compromising a single signer cannot bypass compliance.

### 15.6  Built-In 98/2 Custody Rule

HK SFC requires licensed platforms to keep **≤ 2% of client assets in hot wallets**. TokenHub enforces this on-chain via `WalletRegistry` with automated sweep alerts and a 2-of-3 multi-sig warm wallet — regulatory compliance enforced by code, not by policy documents.

### 15.7  On-Chain Governance

Token holders can vote on protocol changes through a full governance lifecycle: Proposal → Voting (For / Against / Abstain) → Queue → Timelock (48 h) → Execute. No competing STO platform offers native on-chain governance.

### 15.8  Upgradeable Tokens (UUPS Proxy)

TokenFactory V2 allows **atomic upgrade of all tokens** without redeployment, token burning, or re-issuance — fix bugs or add features to live tokens seamlessly.

### 15.9  Three-Layer KYC Enforcement on Trading

TokenHub enforces KYC at three independent layers: (1) **OrderBook contract** blocks non-KYC wallets at order time, (2) **SecurityToken `_update()` hook** checks compliance on every transfer (including escrow), (3) **Frontend Trading UI** disables order forms for unverified users. This defense-in-depth approach cannot be bypassed via MetaMask or external tools.

### 15.10  HK SFC Regulatory Alignment

TokenHub is purpose-built for the Hong Kong regulatory framework, covering the full SFC licensing checklist in a single platform — rather than stitching together 5+ vendor products.

### 15.11  Comprehensive Test Coverage

The project includes **301 documented frontend test cases** (147 positive + 154 negative) across 15 functional areas, plus Hardhat Solidity test suites — unusual for a startup/academic project and critical for regulatory audit readiness.

---

## 16  Citation List

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
