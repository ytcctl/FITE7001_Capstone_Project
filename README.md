# TokenHub Smart Contracts

> Permissioned security token platform integrated with Hong Kong Science & Technology Parks (HKSTP) for fractional equity tokenization, ONCHAINID identity management, tiered custody, on-chain governance, and atomic DvP settlement.

---

## Architecture Overview

TokenHub operates on a **Hyperledger Besu** permissioned network (EVM-compatible) with four validator nodes — HKSTP, Platform Operator, Licensed Custodian, and Regulator Observer.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     INVESTOR PORTAL  (React / Vite)                      │
│  SSO+MFA │ KYC Upload │ Wallet │ Order Book │ Portfolio │ Governance     │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
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
│  ┌─────────────────────┐  ┌──────────────────────┐  ┌────────────────┐  │
│  │  Custody Layer       │  │ Governance Layer     │  │ Identity Layer │  │
│  │  WalletRegistry     │  │ HKSTPGovernor        │  │ IdentityFactory│  │
│  │  MultiSigWarm       │  │ HKSTPTimelock        │  │ Identity (734) │  │
│  └─────────────────────┘  └──────────────────────┘  │ ClaimIssuer    │  │
│                                                      └────────────────┘  │
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
| Minting / Burning | Only addresses with `AGENT_ROLE` (licensed custodians) |
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

## 5  Contract Interaction Diagram

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

---

## 6  Project Structure

```
contracts/
├── HKSTPSecurityToken.sol        # ERC-3643 security token
├── HKSTPIdentityRegistry.sol     # KYC/AML claim registry
├── HKSTPCompliance.sol           # Modular compliance + EIP-712 attestation
├── DvPSettlement.sol             # Atomic delivery-vs-payment
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
├── deploy.js                     # Full deployment script
├── deploy-and-update-frontend.js # Deploy + write ABI/addresses to frontend
├── deploy-health-check.js        # Deploy & run SystemHealthCheck
├── seed-investor.js              # Seed test investor identities
├── harden-admin.js               # Post-deploy admin hardening
└── burn-excess.js                # Burn excess token supply

test/
├── HKSTPSecurityToken.test.js    # Token deployment, mint, transfer, pause, freeze
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

### Prerequisites
- Node.js ≥ 18 (required by Hardhat ^2.22.4)
- npm ≥ 9
- Docker (for Hyperledger Besu local network)

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
| `test/HKSTPSecurityToken.test.js` | Deployment, minting, transfers, safe-list, pause, freeze |
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

### Local Hardhat Network

```bash
npx hardhat node &
npm run deploy:local
```

### Hyperledger Besu Network

```bash
# Start Besu node
npm run besu:start

# Deploy contracts
export BESU_RPC_URL="http://<besu-node>:8545"
export BESU_PRIVATE_KEYS="<deployer-private-key>"
export COMPLIANCE_ORACLE="<oracle-address>"
export TREASURY_ADDRESS="<treasury-address>"
export ESCROW_ADDRESS="<escrow-address>"
export CUSTODIAN_ADDRESS="<custodian-address>"

npm run deploy:besu
```

### Deployment Order

1. **`IdentityFactory`** — ONCHAINID minimal proxy factory
2. **`HKSTPIdentityRegistry`** — KYC/AML claim storage (linked to IdentityFactory)
3. **`HKSTPCompliance`** — attestation + module enforcement
4. **`OracleCommittee`** — multi-oracle threshold committee
5. **`HKSTPSecurityToken`** — linked to registry + compliance (or via `TokenFactory`)
6. **`TokenFactory` / `TokenFactoryV2`** — deploy multiple startup tokens
7. **`MockCashToken`** — tokenized HKD (replace with Project Ensemble contract in production)
8. **`DvPSettlement`** — atomic settlement engine
9. **`WalletRegistry`** — custody tier registry + 98/2 enforcement
10. **`MultiSigWarm`** — warm wallet multi-sig
11. **`HKSTPGovernor` + `HKSTPTimelock`** — governance stack
12. **`SystemHealthCheck`** — run post-deployment wiring verification

### Post-Deployment Steps

1. Grant `TOKEN_ROLE` on `HKSTPCompliance` to `HKSTPSecurityToken`
2. Grant `AGENT_ROLE` on `HKSTPSecurityToken` to licensed custodian wallets
3. Safe-list treasury, escrow, and custody addresses on the token
4. Grant `OPERATOR_ROLE` on `DvPSettlement` to the matching engine service account
5. Register oracle members on `OracleCommittee` and set threshold
6. Register investor identities via `IdentityFactory.deployIdentity()` + `HKSTPIdentityRegistry.registerIdentity()`
7. Set KYC claims via `HKSTPIdentityRegistry.setClaim()`
8. Register wallet tiers in `WalletRegistry` (hot, warm, cold)
9. Configure `MultiSigWarm` signers
10. Grant `PROPOSER_ROLE` / `EXECUTOR_ROLE` on `HKSTPTimelock` to `HKSTPGovernor`
11. Run `SystemHealthCheck.fullHealthCheck()` to verify all wiring
12. Run `scripts/harden-admin.js` to finalize admin role configuration

---

## 10  Security Considerations

- All transfers are gated by the Identity Registry (both parties must be KYC-verified)
- Compliance module checks run on every non-safe-listed transfer
- **OracleCommittee** requires threshold-based multi-oracle attestation — no single point of failure
- DvP uses `ReentrancyGuard` to prevent re-entrancy attacks
- Emergency pause available on token, DvP, and WalletRegistry contracts
- Attestations are one-time-use (replay protection via nonce + used-hash mapping)
- `AccessControl` used throughout — role-based, no single-owner risk
- Follows checks-effects-interactions pattern in `executeSettlement()`
- **98/2 custody ratio** enforced on-chain via `WalletRegistry` with automated sweep alerts
- **Multi-sig warm wallet** (`MultiSigWarm`) requires 2-of-3 for rebalancing
- Air-gapped cold storage with FIPS 140-2 Level 3+ HSMs
- Governor + Timelock provide a 48-hour review window before on-chain governance execution
- `SystemHealthCheck` provides automated post-deployment verification

---

## 11  SFC Regulatory Alignment

| Requirement | Implementation |
|-------------|----------------|
| Investor suitability | `HKSTPIdentityRegistry` — 5 claim topics + ONCHAINID identity verification |
| Transfer restrictions | `HKSTPCompliance` — jurisdiction, lock-up, concentration caps |
| Multi-oracle attestation | `OracleCommittee` — threshold-based multi-sig for compliance approvals |
| Settlement finality | `DvPSettlement` — atomic single-transaction, immutable audit trail |
| Emergency intervention | `pause()` on token, DvP, and WalletRegistry (PAUSER_ROLE / DEFAULT_ADMIN_ROLE) |
| Audit trail | Events on every state change across all contracts |
| Custody safeguards | `WalletRegistry` (98/2 enforcement) + `MultiSigWarm` (2-of-3 warm wallet) |
| Cold storage compliance | Air-gapped signing, FIPS 140-2 Level 3+ HSM, key ceremony quorum controls |
| Forced transfer / rectification | `forcedTransfer()` (EIP-1644) with IPFS-anchored legal proof |
| Shareholder cap | 50-shareholder limit enforced via identity-linked compliance module |
| Governance transparency | `HKSTPGovernor` + `HKSTPTimelock` — KYC-gated voting, 48-hour execution delay |
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
