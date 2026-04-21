# Tokenizing HKSTP Startups: A Blockchain Ecosystem for Innovative Financing and Investor Engagement

**Capstone Project Report — FITE7001**
Master of Science in Financial Technology and Data Analytics
Faculty of Engineering, The University of Hong Kong

| | |
|---|---|
| **Team / Project** | TokenHub |
| **Authors** | Chan Kwun Yu · Choi Chi For · Kiang Ho Tin (Product Owner) · Tam King Yin · Wong Hiu Leung |
| **Supervisor** | Dr. Siu Ming Yiu |
| **Date** | April 2026 |
| **Repository** | [github.com/ytcctl/FITE7001_Capstone_Project](https://github.com/ytcctl/FITE7001_Capstone_Project) |

---

## Abstract

TokenHub is a compliance-first, permissioned blockchain platform that digitises the full lifecycle of Hong Kong Science & Technology Parks (HKSTP) startup equity — from primary issuance of fractional security tokens to regulated secondary trading with atomic Delivery-versus-Payment (DvP) settlement. The project delivers an end-to-end reference implementation consisting of eighteen production-oriented Solidity smart contracts (ERC-3643 / T-REX inspired), a React/Vite investor portal with role-based access, and a complete regulatory analysis aligned with the Hong Kong Securities and Futures Commission (SFC) "see-through" tokenisation regime, the Hong Kong Monetary Authority (HKMA) Project Ensemble framework, and the Anti-Money Laundering and Counter-Terrorist Financing Ordinance (AMLO, Cap. 615).

Key technical contributions include: (i) a rectifiable ledger architecture with an EIP-1644-inspired `forcedTransfer()` anchored to IPFS-hashed court orders, resolving the statutory void-disposition risk under Companies (Winding Up) Ordinance (Cap. 32) s.182; (ii) a tiered 98/2 hot-warm-cold custody registry enforcing the SFC's January 2025 VATP conduct standard on-chain; (iii) a hybrid off-chain / on-chain compliance engine using EIP-712 attestations consumed through an N-of-M Oracle Committee to remove single-oracle key-compromise risk; (iv) KYC-gated on-chain governance using OpenZeppelin Governor + Timelock with identity-locked voting that rejects flash-loan manipulation; and (v) a three-layer KYC enforcement pattern (OrderBook gate, `_update()` hook, frontend guard) guaranteeing that no unverified address can trade, settle, or be minted to, regardless of the client tool used.

The system has been statically analysed with Slither (all high-severity findings remediated), covered by 12 Hardhat test suites plus 321 documented frontend functional test cases, and deployed reproducibly through GitHub Codespaces and Hyperledger Besu. Compared with existing platforms such as Tokeny T-REX, Polymesh, Securitize, ADDX, HashKey and BondbloX, TokenHub uniquely combines (a) full-stack regulatory alignment to the Hong Kong regime, (b) a custodian-grade rectifiable ledger, (c) integrated KYC-gated governance with atomic DvP, and (d) an open, academically reproducible reference implementation — attributes that no single incumbent delivers together.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Background, Motivation and Objectives](#2-background-motivation-and-objectives)
3. [Literature Review and Regulatory Landscape](#3-literature-review-and-regulatory-landscape)
4. [System Architecture](#4-system-architecture)
5. [Smart Contract Design and Implementation](#5-smart-contract-design-and-implementation)
6. [Investor Portal — Frontend Implementation](#6-investor-portal--frontend-implementation)
7. [Compliance, Custody and KYC/AML Framework](#7-compliance-custody-and-kycaml-framework)
8. [Governance, Corporate Actions and Safeguards](#8-governance-corporate-actions-and-safeguards)
9. [Testing, Security Audit and Validation](#9-testing-security-audit-and-validation)
10. [Deployment and Reproducibility](#10-deployment-and-reproducibility)
11. [Competitive Analysis — Why TokenHub Stands Out](#11-competitive-analysis--why-tokenhub-stands-out)
12. [Results and Evaluation](#12-results-and-evaluation)
13. [Limitations and Future Work](#13-limitations-and-future-work)
14. [Conclusion](#14-conclusion)
15. [References](#15-references)

---

## 1. Introduction

Early-stage equity financing in Hong Kong remains slow, expensive, and illiquid. HKSTP hosts more than 1,000 technology startups, yet their fundraising cycles typically span three to six months, cap-table updates are manual and error-prone, settlement is T+2 or longer, and secondary liquidity for private shares is effectively nil until an IPO or trade sale. At the same time, Hong Kong's regulators have moved decisively to embrace regulated tokenisation: the SFC's November 2023 circular articulated the "see-through" principle that tokenised securities remain securities; the HKMA launched Project Ensemble in 2024 and extended it to real-value transactions in November 2025; and the SFC's January 2025 conduct standards for Virtual Asset Trading Platforms (VATPs) set explicit expectations for custody, hot/cold segregation, and key management.

TokenHub proposes a reference blockchain ecosystem that leverages this regulatory clarity to shorten fundraising timelines, introduce fractional ownership, open regulated secondary markets, and automate post-trade life-cycle management — without sacrificing the legal-finality, investor-protection and anti-money-laundering guarantees demanded by the Hong Kong regime.

This report synthesises the full body of work produced for the FITE7001 capstone: regulatory analysis, architecture, 18 smart contracts (≈6,000 lines of Solidity), a 19-page React/Vite investor portal, 321 frontend test cases, a Slither security audit, and a Codespaces-reproducible deployment pipeline.

---

## 2. Background, Motivation and Objectives

### 2.1 Problem Statement

| Stakeholder | Current Pain Point |
|---|---|
| HKSTP startup | 3–6 month fundraising cycle; manual cap tables; high legal/broker fees; slow fund disbursement |
| Retail / professional investor | No fractional access to early-stage equity; no liquidity pre-exit; high information asymmetry |
| HKSTP / regulator | Limited visibility into post-issuance secondary transfers; reliance on off-chain attestations; fragmented KYC across issuers |

### 2.2 Project Objectives

| # | Objective | Success Metric |
|---|---|---|
| 1 | Automated compliance and investor onboarding | KYC/AML gate enforced at contract, oracle and portal layers; zero non-verified transfers |
| 2 | Lower investment barriers via fractional ownership | Security token divisibility to 10⁻¹⁸; minimum-ticket flexibility |
| 3 | Broader and faster capital mobilisation | Instant issuance; direct-to-investor distribution |
| 4 | Instant settlement (T+0) | Atomic DvP in a single indivisible transaction |
| 5 | Lower transaction cost | Disintermediated issuance and settlement; no transfer agents |
| 6 | Secondary market activation | 24/7 regulated on-chain order book with automatic matching |
| 7 | Secure token management and reporting | Tiered custody (98/2), on-chain events, real-time dashboards |

### 2.3 Scope and Deliverables

- **Regulatory framework** — legal characterisation, licensing strategy, KYC/AML manual (see [Regulatory_Feasibility.md](Regulatory_Feasibility.md))
- **Blockchain architecture** — permissioned EVM network, rectifiable ledger, tiered custody, atomic DvP (see [tokenhub_architecture_Interim.md](tokenhub_architecture_Interim.md))
- **Smart-contract suite** — 18 contracts in [contracts/](contracts/)
- **Investor portal** — React/Vite application in [frontend/](frontend/) with 19 role-gated pages and 321 test cases
- **Security** — Slither static analysis, 12 Hardhat test suites, Besu end-to-end integration test
- **Reproducibility** — one-click GitHub Codespaces environment with 3-minute bootstrap to live portal

---

## 3. Literature Review and Regulatory Landscape

### 3.1 Token Standards for Permissioned Securities

| Standard | Role in TokenHub |
|---|---|
| **ERC-20** | Baseline fungibility — used for the THKD cash-token mock |
| **ERC-3643 (T-REX)** | Compliance-by-design security token — every transfer is pre-checked by an Identity Registry and Compliance module |
| **ERC-1644 (Controller Token Operation)** | Basis for `forcedTransfer()` — enables rectification of the ledger on court order |
| **ERC-734/735 (ONCHAINID)** | Identity contracts and verifiable claims per investor |
| **ERC-6372 (Clock Mode)** | Timestamp-based voting clock for governance |
| **ERC20Votes** | Flash-loan-resistant snapshot voting weight |
| **EIP-1167** | Minimal-proxy identity deployment (~45 kB vs ~2 MB) — ~90 % gas reduction |
| **EIP-712 / EIP-1967** | Structured off-chain signed attestations; upgradeable token proxies |

### 3.2 Hong Kong Regulatory Framework

- **Securities and Futures Ordinance (Cap. 571)** — governs Type 1 (Dealing in Securities) and Type 7 (Automated Trading Services) regulated activities; SFC "see-through" circular of 2 Nov 2023 confirms that tokenised securities are securities.
- **AMLO (Cap. 615)** — mandates CDD, PEP/sanctions screening, and FATF Travel Rule compliance (SFC AML Guideline for LCs and SFC-licensed VASPs, Jun 2023).
- **Companies Ordinance (Cap. 622)** — imposes the 50-shareholder cap on private companies, forcing TokenHub to enforce unique-identity holder counts rather than wallet counts.
- **Companies (Winding Up and Miscellaneous Provisions) Ordinance (Cap. 32), s. 182** — any disposition of property after a winding-up petition is void unless the court otherwise orders; this is the statutory reason TokenHub's ledger must be rectifiable.
- **Clearing and Settlement Systems Ordinance (Cap. 584) / PSSVFO** — settlement finality is only statutorily guaranteed for HKMA-designated Clearing and Settlement Systems; TokenHub cannot qualify and therefore relies on **contractual finality** anchored in platform terms, token subscription agreements and smart-contract logic.
- **SFC VATP Conduct Standards (16 Jan 2025)** — require 98 % of client assets in cold storage, FIPS 140-2 Level 3+ HSMs, air-gapped signing, geographic key distribution, and multi-party quorum key ceremonies.
- **HKMA Project Ensemble (Mar 2024, extended Nov 2025)** — target operating model for tokenised deposits + wCBDC atomic DvP, which TokenHub's DvP contract is designed to integrate with.

### 3.3 Comparable Platforms

A detailed competitive comparison is deferred to §11. Platforms considered: Tokeny T-REX (issuance toolkit), Polymesh (purpose-built L1), Securitize, ADDX (Singapore MAS), INX, tZERO, Figure, BondbloX, HashKey Group, OSL and Hex Trust.

---

## 4. System Architecture

### 4.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     INVESTOR PORTAL  (React / Vite)                      │
│  SSO+MFA │ KYC │ Wallet │ Trading │ Markets │ Governance │ Custody       │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │  KYC frontend guard
         ┌─────────────────────────▼────────────────────────┐
         │        COMPLIANCE / ORACLE SERVICE               │
         │  OracleCommittee — N-of-M EIP-712 attestation    │
         └─────────────────────────┬────────────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────────────────────────┐
│                  HARDHAT NETWORK / HYPERLEDGER BESU  (EVM)               │
│  Token Layer │ Identity Layer │ Trading Layer │ Custody Layer │ Gov.     │
│  DvPSettlement · OrderBook · WalletRegistry · Governor · Timelock        │
└──────────────────────────────────────────────────────────────────────────┘
```

The platform is organised into six cohesive layers described in the project [README.md](README.md):

1. **Token & Compliance layer** — `HKSTPSecurityToken`, `HKSTPCompliance`, `HKSTPIdentityRegistry`
2. **Trading layer** — `OrderBookFactory` + per-market `OrderBook`
3. **Settlement layer** — `DvPSettlement`, `MockCashToken`
4. **Identity layer** — `Identity`, `ClaimIssuer`, `IdentityFactory`
5. **Custody layer** — `WalletRegistry`, `MultiSigWarm`
6. **Governance layer** — `HKSTPGovernor`, `HKSTPTimelock`, `GovernorFactory`

Auxiliary contracts: `TokenFactory` and `TokenFactoryV2` (upgradeable via ERC-1967) for "one token per startup" deployment, `OracleCommittee` for N-of-M compliance attestation, and `SystemHealthCheck` for post-deployment wiring verification.

### 4.2 Design Principles

- **Compliance-by-design** — transfer restrictions are enforced in Solidity via an `_update()` hook that cannot be bypassed by any client.
- **Policy off-chain, enforcement on-chain** — policy logic lives in an off-chain Compliance Oracle service; smart contracts enforce signed attestations cheaply (~3,000 gas for `ecrecover`).
- **Rectifiable ledger** — agents holding `AGENT_ROLE` can execute `forcedTransfer()` with a `bytes32 legalOrderHash` and `bytes operatorData` referencing an IPFS-stored court order.
- **One token per startup** — legal-entity isolation; EIP-1167 minimal proxies keep per-deployment gas cost ~45k instead of ~2M.
- **Shared identity, per-token compliance** — a single `IdentityRegistry` serves all tokens; compliance modules (caps, lock-ups, jurisdictions) are scoped per token address.
- **Defence in depth** — KYC is enforced at three layers: OrderBook entry, token `_update()`, and frontend guard.

### 4.3 Data Flows

DvP settlement, OrderBook trading, and three-layer KYC enforcement flows are detailed in [README.md §5](README.md) (sections 5.1–5.3) with ASCII sequence diagrams. The key invariants:

- Every transfer passes through `HKSTPSecurityToken._update()` which calls `IdentityRegistry.isVerified()` and `HKSTPCompliance.checkModules()`.
- Only **burns** skip compliance; **mints** are treated as transfers from a safe-listed sender so recipient-side caps, lock-ups, jurisdiction and KYC still apply.
- OrderBook contracts are safe-listed on the token so escrow-to-buyer transfers do not require per-trade oracle attestation, but buyer/seller identity is still independently verified.

---

## 5. Smart Contract Design and Implementation

### 5.1 Contract Inventory

| Contract | LoC (approx.) | Purpose |
|---|---|---|
| [HKSTPSecurityToken.sol](contracts/HKSTPSecurityToken.sol) | 450 | ERC-3643-style token; pause, freeze, mint tiers, supply cap, shareholder cap |
| [HKSTPIdentityRegistry.sol](contracts/HKSTPIdentityRegistry.sol) | 380 | Address → ONCHAINID mapping; claim topic validation |
| [HKSTPCompliance.sol](contracts/HKSTPCompliance.sol) | 420 | Per-token modules; EIP-712 attestation; replay protection |
| [DvPSettlement.sol](contracts/DvPSettlement.sol) | 310 | Atomic 2-leg settlement + FATF Travel Rule hashes |
| [OrderBook.sol](contracts/OrderBook.sol) | 580 | Limit-order book with KYC gate and escrow |
| [OrderBookFactory.sol](contracts/OrderBookFactory.sol) | 160 | One OrderBook per token pair |
| [OracleCommittee.sol](contracts/OracleCommittee.sol) | 250 | N-of-M threshold EIP-712 signature verification |
| [TokenFactory.sol](contracts/TokenFactory.sol) / [TokenFactoryV2.sol](contracts/TokenFactoryV2.sol) | 220 / 280 | Token deployment; V2 adds ERC-1967 upgradeability |
| [SystemHealthCheck.sol](contracts/SystemHealthCheck.sol) | 200 | Post-deploy wiring verification |
| [custody/WalletRegistry.sol](contracts/custody/) | 330 | Hot/Warm/Cold tiers; 98/2 enforcement |
| [custody/MultiSigWarm.sol](contracts/custody/) | 280 | 2-of-3 multi-sig warm wallet |
| [governance/HKSTPGovernor.sol](contracts/governance/) | 240 | OZ Governor + KYC gate on `_castVote()` |
| [governance/HKSTPTimelock.sol](contracts/governance/) | 60 | 48-hour execution delay |
| [governance/GovernorFactory.sol](contracts/governance/) | 140 | Per-token governance registry |
| [identity/Identity.sol](contracts/identity/) | 320 | ERC-734/735 key + claim storage |
| [identity/ClaimIssuer.sol](contracts/identity/) | 140 | Trusted-issuer signature verification |
| [identity/IdentityFactory.sol](contracts/identity/) | 140 | EIP-1167 minimal-proxy identity |
| [mocks/MockCashToken.sol](contracts/mocks/) | 70 | ERC-20 tokenised HKD (THKD) mock |

### 5.2 Core Transfer Pipeline

`HKSTPSecurityToken._update(from, to, amount)` is the choke point:

1. **Pause guard** — `whenNotPaused`.
2. **Burn fast-path** — `to == address(0)` skips compliance.
3. **Freeze check** — both `from` and `to` must not be frozen.
4. **Safe-list path** — operational contracts (OrderBook, DvP, treasury) bypass oracle attestation but not identity verification.
5. **Identity verification** — `identityRegistry.isVerified(to)` for mints; both sides for transfers.
6. **Compliance module check** — `HKSTPCompliance.checkModules()` enforces per-investor cap, global cap, jurisdiction whitelist, and lock-up period.
7. **Attestation consumption** — if not safe-listed, a one-time EIP-712 attestation from the Oracle Committee is consumed (replay-protected by nonce + expiry).
8. **Shareholder cap** — identity-deduplicated holder count ≤ `maxShareholders` (Cap. 622).

### 5.3 Tiered Minting Safeguard

`mint(to, amount)` enforces a two-tier role model (see [Safeguard.md](Safeguard.md)):

| Mint size | Required role | Authorisation path |
|---|---|---|
| `amount ≤ mintThreshold` | `AGENT_ROLE` | Single transaction by licensed custodian |
| `amount > mintThreshold` | `TIMELOCK_MINTER_ROLE` | Governor proposal + 7-day vote + 48-hour timelock |

Additional guards on every mint: self-dealing prevention (`to != msg.sender`), hard `maxSupply` cap, full compliance pipeline on the recipient, and shareholder-cap enforcement.

### 5.4 Atomic DvP Settlement

`DvPSettlement.executeSettlement(id)` performs:

```
Leg 1: securityToken.transferFrom(seller → buyer)    // triggers full compliance pipeline
Leg 2: cashToken.transferFrom(buyer → seller)
```

If either leg reverts, the EVM unwinds both — eliminating principal risk. Pre-flight checks (balance, KYC, freeze, lock-up, deadline) produce a graceful `Failed` state with a human-readable reason rather than a bare revert, supporting operator diagnostics. The contract also records FATF Travel Rule metadata (originator/beneficiary VASP hashes, PII hashes — never raw PII) for transfers ≥ HK$8,000.

### 5.5 Oracle Committee (Threshold Attestation)

`OracleCommittee.verifyMultiAttestation()` verifies that an attestation digest `keccak256(from, to, amount, expiry, nonce)` has been signed by ≥ `threshold` distinct oracle members. `consumeMultiAttestation()` additionally enforces one-time use. This eliminates the single-oracle key as a single point of failure and is the production path for compliance attestation; the devnet uses the simpler single-signer `consumeAttestation()` path for convenience.

### 5.6 OrderBook — Regulated On-Chain Trading

Each security-token / cash-token pair has a dedicated `OrderBook` deployed by `OrderBookFactory`. Distinctive features:

- **KYC gate at order time** — `placeBuyOrder` / `placeSellOrder` revert if `isVerified(msg.sender) == false`.
- **Escrow model** — buy orders lock cash; sell orders lock security tokens into the contract.
- **Auto-matching** with partial fills, price-time priority, and maker-price execution.
- **Admin force-cancel** (`forceCancelOrder`) with on-chain reason string.
- **Batch compliance cancel** (`cancelOrdersForNonCompliant`) — single transaction cancels all open orders of a KYC-revoked investor (on-chain `!isVerified()` guard prevents misuse).
- **Escrowed-token handling** — when a refund is blocked because the seller's KYC was revoked, tokens remain escrowed and a `TokensEscrowed` event is emitted; admin then disposes via `forcedTransfer()`.

### 5.7 Gas Optimisation Strategies

1. **EIP-1167 minimal proxies** for Identity deployments — ~45k gas vs ~2M (≈90 % saving).
2. **ERC-1967 upgradeable proxies** in `TokenFactoryV2` — enables in-place logic upgrades without re-issuing tokens.
3. **Shared IdentityRegistry** across all tokens — an investor verified once can purchase any startup without incremental on-chain writes.
4. **EIP-712 off-chain attestations** — policy logic off-chain; on-chain `ecrecover` costs ~3,000 gas.
5. **Indexed event logs** for audit trails (the "genealogy of a share") — ~1–2k gas vs ~20k for storage slots.

---

## 6. Investor Portal — Frontend Implementation

The portal (located in [frontend/](frontend/)) is a React 18 + Vite + TypeScript + Tailwind application with 19 role-gated pages. Key design elements:

- **Wallet connectivity** — MetaMask, built-in dev wallets, and custom private-key import.
- **Role detection** — the `Web3Context` introspects on-chain roles (`DEFAULT_ADMIN_ROLE`, `AGENT_ROLE`, `OPERATOR_ROLE`) and renders routes accordingly, with server-side-style guards that redirect unauthorised URL access to the Dashboard.
- **Network guard** — a yellow banner alerts users when MetaMask is on the wrong chain, with a one-click switch.
- **KYC-gated trading** — `Trading.tsx` checks `identityRegistry.isVerified(account)` on load and disables order entry with a red banner for non-KYC wallets.
- **Last traded price and 24-hour % change** — computed client-side from the on-chain `Trade` events of each OrderBook.
- **Admin surfaces** — Token Management (V1 + V2 tabs), Compliance Rules, Token Compliance Detail, Market Management, Freeze Management, Oracle Committee, Wallet Custody (98/2 dashboard).
- **Dev ergonomics** — `MintETH.tsx` uses `anvil_setBalance` for local test ETH; Codespaces-aware RPC URL resolution.

The portal is documented by 321 functional test cases (160 positive + 161 negative) across 15 modules — see [frontend/FRONTEND-TEST-CASES.md](frontend/FRONTEND-TEST-CASES.md) and the QMetry-import-ready CSV at [frontend/FRONTEND-TEST-CASES-QMetry.csv](frontend/FRONTEND-TEST-CASES-QMetry.csv).

---

## 7. Compliance, Custody and KYC/AML Framework

### 7.1 KYC/AML Framework

TokenHub implements the SFC "same activity, same risk, same rules" principle through six on-chain claim topics anchored in an investor's ONCHAINID:

| Topic | Claim |
|---|---|
| 1 | KYC Verified |
| 2 | Accredited / Professional Investor |
| 3 | Jurisdiction Approved (HK / non-sanctioned) |
| 4 | Source of Funds Verified |
| 5 | PEP / Sanctions Clear |
| 6 | FPS Name-Match Verified |

Off-chain the compliance layer implements a Risk-Based Approach (RBA), designated Compliance Officer and MLRO, five-year record retention, and FATF Recommendation 16 Travel Rule via the close-loop `Permissioned Custody and Transfer` model — every on-chain transfer hash is synchronised with pre-verified originator/beneficiary UBO data in an off-chain audit trail, avoiding on-chain PII exposure while meeting s.12.11 of the SFC AML Guideline.

### 7.2 Custody Architecture (98/2)

Per the SFC's January 2025 VATP conduct standards, `WalletRegistry` classifies every address as Hot, Warm or Cold and enforces `hotCapBps` on each tracked token. Hot balance above the cap emits a `SweepRequired` event consumed by an off-chain sweeper. `MultiSigWarm` provides a 2-of-3 multi-signature warm wallet with propose / confirm / revoke / execute, deadline-based expiry, and signer-rotation. Cold custody is intentionally implemented **without smart contracts** — it is an air-gapped HSM workflow (FIPS 140-2 Level 3+, Level 4 tamper-active for high-value startups) with multi-party key ceremonies and geographic backup-seed distribution within Hong Kong.

### 7.3 Rectifiable Ledger

`forcedTransfer(from, to, amount, legalOrderHash, operatorData)` resolves the s.182 Cap. 32 void-disposition risk. Authorisation is gated by `AGENT_ROLE`; the receiver must still be KYC-verified; the function temporarily safe-lists both parties to bypass compliance modules while still emitting a `ForcedTransfer` event containing the `bytes32` hash of the court order and operator context. A self-dealing invariant (`to != msg.sender`) prevents agent abuse.

### 7.4 Deposit / Withdrawal Workflow

Deposits flow through Hong Kong's FPS: the portal issues a QR / proxy ID, the investor pays from a name-matched bank account, the platform receives a real-time confirmation, and the cash contract mints THKD into the investor's permissioned wallet. Withdrawals burn THKD and release HKD to the same verified bank account (closed-loop AML). The architecture is designed to migrate to Project Ensemble tokenised deposits and wCBDC for cross-ledger atomic DvP.

---

## 8. Governance, Corporate Actions and Safeguards

### 8.1 On-Chain Governance

`HKSTPGovernor` extends OpenZeppelin Governor with two security-critical modifications:

1. **KYC-gated voting** — `_castVote()` calls `IdentityRegistry.isVerified(voter)`. Revoked or expired KYC blocks the vote in real time and emits `VoteBlockedKYC`.
2. **Flash-loan resistance** — voting weight is snapshotted via `ERC20Votes` at proposal creation (`clock() - 1`); tokens acquired afterwards carry zero weight for that proposal.

Production parameters: 2-day voting delay, 7-day voting period, 1 % proposal threshold, 10 % quorum, 48-hour Timelock delay (≈11-day end-to-end cycle).

### 8.2 Corporate Actions

Corporate-action flows are described in [CorporateAction.md](CorporateAction.md):

- **Book close / record date** — replaced by `ERC20Votes` timestamp checkpoints; `getPastVotes()` and `getPastTotalSupply()` provide pro-rata calculations at any historical timestamp.
- **Pause / freeze** — global `pause()` by admin; per-address `setAddressFrozen()` by agent.
- **Rights issue / new issuance** — governance-approved mint via timelock.
- **Redemption** — `forcedTransfer` + `burn`.
- **Dividends (planned)** — architectural path via `getPastTotalSupply(recordTs)` is in place; implementation deferred.

### 8.3 Safeguards Summary

Every material state transition is protected by at least two independent controls — e.g. a large mint requires both on-chain governance approval **and** a timelock delay, and even then recipient KYC, jurisdiction, concentration caps and shareholder cap are enforced inside `_update()`.

---

## 9. Testing, Security Audit and Validation

### 9.1 Test Coverage

| Suite | Focus |
|---|---|
| [HKSTPSecurityToken.test.js](test/HKSTPSecurityToken.test.js) | Mint, transfer, pause, freeze, supply cap, tiered minting, self-dealing |
| [HKSTPCompliance.test.js](test/HKSTPCompliance.test.js) | EIP-712 attestation, replay, module checks |
| [DvPSettlement.test.js](test/DvPSettlement.test.js) | Atomic execution, pre-flight, deadline, pause |
| [Identity.test.js](test/Identity.test.js) | ONCHAINID deployment, claim lifecycle |
| [OracleCommittee.test.js](test/OracleCommittee.test.js) | N-of-M threshold, oracle management |
| [TokenFactory.test.js](test/TokenFactory.test.js) | Factory lifecycle, symbol uniqueness |
| [Governance.test.js](test/Governance.test.js) | KYC-gated voting, proposal lifecycle, timelock |
| [WalletArchitecture.test.js](test/WalletArchitecture.test.js) | 98/2 enforcement, multi-sig flows |
| [ShareholderCap.test.js](test/ShareholderCap.test.js) | Cap. 622 50-shareholder enforcement |
| [AML.test.js](test/AML.test.js) | Rejection scenarios, PEP / sanctions |
| [ActionPlan.test.js](test/ActionPlan.test.js) | End-to-end business scenarios |
| [integration/besu-e2e.test.js](test/integration/) | Full Hyperledger Besu multi-validator integration |

Plus 321 frontend functional test cases documented in QMetry-import format.

### 9.2 Static Analysis (Slither)

Slither v0.11.5 identified 37 findings across 77 analysed contracts — all 29 OpenZeppelin findings are well-known audited patterns (out of scope); TokenHub-originated findings are summarised in [SLITHER-REPORT.md](SLITHER-REPORT.md):

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | `locked-ether` in MultiSigWarm | **Fixed** — `withdrawETH()` gated by `DEFAULT_ADMIN_ROLE` |
| 2 | High | `reentrancy-no-eth` in TokenFactory | **Fixed** — CEI pattern |
| 3 | High | `reentrancy-no-eth` in IdentityFactory | **Fixed** — CEI pattern |
| 4 | High | `reentrancy-no-eth` in HKSTPIdentityRegistry | Accepted — `onlyRole(DEPLOYER_ROLE)` mitigation |
| 5–8 | Medium | Strict equality / uninitialised locals | Accepted — false positives / standard patterns |

All residual risks (reentrancy, locked-ether, overflow, access control, flash-loan) are mitigated and documented.

### 9.3 Validation Environment

| Component | Details |
|---|---|
| Dev blockchain | Hardhat Network (chain ID 31337), auto-mine |
| Prod-like blockchain | Hyperledger Besu, 4 validator IBFT2 network |
| Cash token | `MockCashToken` ERC-20 (tokenised HKD) |
| Wallets | Admin / Agent / Operator / multiple Investor accounts |

---

## 10. Deployment and Reproducibility

A reviewer or examiner can reproduce the entire environment in under five minutes via GitHub Codespaces (see [CodeSpace_deployment.md](CodeSpace_deployment.md) and [README.md §7](README.md)):

1. Open the repository in Codespaces.
2. `post-create.sh` runs once: installs dependencies and compiles contracts.
3. `start.sh` runs on every start: spawns Hardhat Network, deploys all 18 contracts via `deploy-and-update-frontend.js`, auto-writes addresses to `frontend/src/config/contracts.ts`, seeds a test investor, and launches Vite on port 3000.
4. Codespaces auto-forwards port 3000; the portal opens in a new browser tab.

Alternative paths: local `npm install && npx hardhat node && npm run deploy:local && cd frontend && npm run dev`, or `npm run deploy:besu` for the unified Besu launcher with the custom Engine-API V3 block producer in [besu/block-producer.js](besu/block-producer.js).

State snapshots (`anvil-snapshot-*.json`) allow replaying a pre-seeded portfolio — see [Tokenhub_Launch.md](Tokenhub_Launch.md) for the Anvil snapshot-restore protocol, including the required clock-advance step to avoid the `getPastVotes → 0` pitfall caused by timestamp-mode `ERC20Votes`.

---

## 11. Competitive Analysis — Why TokenHub Stands Out

### 11.1 Comparable Platforms

| Platform | Jurisdiction Focus | Token Standard | Custody Model | Secondary Trading | Governance | Open Source |
|---|---|---|---|---|---|---|
| **Tokeny T-REX** | Multi (EU-centric) | ERC-3643 | Integrator's choice | Delegated to partners | None built-in | Partial (core libs open) |
| **Polymesh** | Multi | Purpose-built L1 (not EVM) | Identity via CDD claims | Native DEX | Native POS-style | Yes |
| **Securitize** | US / multi | ERC-1400 family (proprietary) | SaaS custodial | Securitize Markets (ATS) | None | Closed |
| **ADDX** | SG MAS | Proprietary | Fully custodial | Continuous MTF | None | Closed |
| **INX / tZERO** | US SEC / ATS | ERC-1404 / proprietary | Custodial | ATS order book | None | Closed |
| **BondbloX** | SG MAS (bonds) | Proprietary | Fully custodial | Bond exchange | None | Closed |
| **HashKey Group / OSL / Hex Trust** | HK VATP (VA focus) | Mixed | Licensed VATP custody | Crypto spot (limited tokenised securities) | None | Closed |
| **TokenHub (this project)** | **HK SFC + HKMA** | **ERC-3643 + ERC-1644 + ERC-734/735 + ERC20Votes** | **98/2 tiered on-chain registry + air-gapped HSM cold** | **On-chain KYC-gated order book + atomic DvP** | **KYC-gated OZ Governor + 48h Timelock** | **Yes (academic, reproducible)** |

### 11.2 Differentiators

1. **Full-stack alignment to the Hong Kong regime** — TokenHub is the only reference implementation that simultaneously addresses SFC Type 1/7 + VATP conduct standards (Jan 2025), AMLO Travel Rule, Companies Ordinance Cap. 622 shareholder cap, Cap. 32 s.182 void-disposition risk, and the HKMA Project Ensemble target model. Incumbents focus on issuance or on trading but rarely on the **legal-finality / rectifiable-ledger / 98/2-custody** trifecta that Hong Kong uniquely demands.

2. **Rectifiable ledger with cryptographic court-order anchoring** — Tokeny and Polymesh offer forced-transfer hooks, but TokenHub hardens the feature with (a) a **strongly-typed `bytes32 legalOrderHash`** in the function signature (vs generic `bytes _data` in ERC-1644), (b) **self-dealing prevention**, (c) **post-transfer freeze-state restoration**, and (d) mandatory receiver KYC re-verification even during a forced transfer — producing an audit trail that is usable by SFC / HKMA examiners out of the box.

3. **Three-layer KYC enforcement** — most platforms enforce KYC at either the token hook (Tokeny T-REX) or the exchange gate (ADDX, Securitize). TokenHub enforces it at **three** independent layers: `OrderBook.placeBuyOrder/placeSellOrder`, `HKSTPSecurityToken._update()`, and the `Trading.tsx` frontend guard — so no custom script, MetaMask call, or API client can trade without verified identity.

4. **N-of-M Oracle Committee for compliance attestation** — Securitize-style architectures rely on a single "Transfer Agent" signer. TokenHub's `OracleCommittee` requires threshold signatures on EIP-712 attestations with nonce + expiry replay protection, eliminating the single-oracle-key compromise vector — a material improvement for regulated institutional use.

5. **KYC-gated on-chain governance with flash-loan resistance** — Polymesh provides native governance, but not KYC-locked voting. Tokeny and Securitize provide none. TokenHub's modified OpenZeppelin Governor rejects votes from non-verified identities (`VoteBlockedKYC`), snapshots weight at proposal creation (ERC20Votes), and gates large mints behind a 48-hour timelock — producing shareholder decisions that are simultaneously auditable, tamper-resistant and regulator-compatible.

6. **98/2 custody enforced on-chain** — ADDX, INX and Securitize keep custody entirely off-chain (and therefore opaque). TokenHub's `WalletRegistry` exposes the Hot/Warm/Cold tier classification, the `hotCapBps` parameter, and `SweepRequired` events on-chain — making the SFC's 98/2 rule **provable by any examiner without vendor cooperation**.

7. **Atomic DvP with FATF Travel Rule metadata** — BondbloX offers DvP for bonds; TokenHub offers DvP for startup equity with an additional `setTravelRuleData()` hook that stores keccak256 hashes of originator/beneficiary VASP identifiers on-chain (no PII), directly addressing SFC AML Guideline s.12.11 while preserving privacy.

8. **Academic reproducibility** — Unlike every commercial comparable, the entire TokenHub stack (smart contracts, portal, tests, deployment) is open, MIT-licensed where applicable, Slither-audited, and reproducible in under five minutes on GitHub Codespaces. This enables examiners, researchers and regulators to **independently verify** claims — a property that no closed-source incumbent can match.

9. **One-token-per-startup + shared identity** — Tokeny and T-REX generally deploy one token per SPV but re-deploy identity infrastructure per issuer. TokenHub uses EIP-1167 minimal-proxy identities and a shared `IdentityRegistry`, so an investor verified once can purchase **any** HKSTP startup token without incremental on-chain KYC cost — solving a concrete gas-cost pain point at portfolio scale.

10. **Upgradeable per-token logic via ERC-1967** — `TokenFactoryV2` deploys each token behind an ERC-1967 proxy, preserving per-investor balances across logic upgrades. Most ERC-3643 implementations (including the reference T-REX repo) treat token contracts as immutable — upgrading logic requires re-issuance, which in a regulated setting is operationally painful.

### 11.3 Summary

TokenHub is not the first tokenised-securities platform, nor the first ERC-3643 implementation, nor the first on-chain order book. Its contribution is the **systematic integration** of these components under the specific constraints of Hong Kong law, delivered as an open, examinable, academically reproducible artefact. No single commercial competitor publishes a full-stack, rectifiable-ledger, 98/2-enforced, KYC-gated, governance-aware, Project-Ensemble-ready platform aligned to the HKSFC/HKMA regime.

---

## 12. Results and Evaluation

### 12.1 Functional Results

| Capability | Status | Evidence |
|---|---|---|
| ERC-3643-style compliant token | ✅ Complete | [HKSTPSecurityToken.sol](contracts/HKSTPSecurityToken.sol), 12 Hardhat test suites |
| Atomic DvP | ✅ Complete | [DvPSettlement.sol](contracts/DvPSettlement.sol) + [DvPSettlement.test.js](test/DvPSettlement.test.js) |
| Permissioned custody (98/2) | ✅ Complete | [WalletRegistry.sol](contracts/custody/), [WalletArchitecture.test.js](test/WalletArchitecture.test.js) |
| Rectifiable ledger | ✅ Complete | `forcedTransfer` + `AML.test.js` |
| KYC-gated order book | ✅ Complete | [OrderBook.sol](contracts/OrderBook.sol), frontend `Trading.tsx` |
| Multi-oracle compliance | ✅ Complete | [OracleCommittee.sol](contracts/OracleCommittee.sol), 10 unit tests |
| KYC-gated governance | ✅ Complete | [HKSTPGovernor.sol](contracts/governance/), [Governance.test.js](test/Governance.test.js) |
| Investor portal | ✅ Complete | 19 pages, 321 functional test cases |
| One-click deployment | ✅ Complete | GitHub Codespaces + `start.sh` |
| Static-analysis audit | ✅ Complete | [SLITHER-REPORT.md](SLITHER-REPORT.md) |

### 12.2 Quantitative Observations

- Identity deployment gas reduced from ~2,000,000 to ~45–65k via EIP-1167 (~90 % saving).
- EIP-712 attestation verification on-chain: ~3,000 gas per transfer.
- Event-log audit trail cost: ~1–2k gas vs ~20k for storage.
- End-to-end governance cycle: ~11 days (2-day delay + 7-day vote + 48-hour timelock).
- Codespaces bootstrap to live portal: ≈3 minutes (measured on a standard 2-core 4-GB Codespace).

### 12.3 Qualitative Observations

- The three-layer KYC pattern provides defence-in-depth that survives frontend or API compromise.
- The `_update()` choke-point pattern makes the compliance surface auditable by a reviewer in one file.
- Devnet-vs-production parameter duplication (identified in [Alignment_Review_v2.md](Alignment_Review_v2.md) §7.1) was a deliberate simplification; the frontend includes fast-forward helpers.

---

## 13. Limitations and Future Work

1. **Production Oracle Committee routing** — `HKSTPCompliance` currently calls `consumeAttestation()` (single signer) on devnet; the `OracleCommittee.consumeMultiAttestation()` path is implemented but not wired as the default. Routing the production deployment through the committee is a near-term item.
2. **Project Ensemble integration** — DvP currently settles against `MockCashToken`. Integration with HKMA Project Ensemble tokenised deposits and wCBDC atomic DvP requires participation in HKMA's sandbox.
3. **Dividend distribution contract** — architecturally supported via `getPastTotalSupply()` but not yet implemented.
4. **Third-party security audit** — Slither static analysis is complete; Trail-of-Bits or OpenZeppelin human audit is recommended before mainnet.
5. **Formal verification** — Certora Prover specifications for key invariants (`totalSupply`, shareholder cap, DvP atomicity) would strengthen assurance.
6. **ERC-1644 event-name harmonisation** — TokenHub emits `ForcedTransfer`; the canonical ERC-1644 event is `ControllerTransfer`. Emitting both would improve tooling interoperability.
7. **Gas-cost benchmarking at scale** — realistic multi-token, multi-investor gas studies on Besu are an open workstream.

---

## 14. Conclusion

TokenHub demonstrates that the compliance-finality-custody trifecta demanded by Hong Kong's tokenisation regime can be engineered without sacrificing the efficiency, transparency and atomicity that make blockchain technology valuable in the first place. By combining ERC-3643 compliance-by-design, an ERC-1644-inspired rectifiable ledger, a 98/2 tiered custody registry, a KYC-gated OpenZeppelin Governor, an atomic DvP settlement contract, and a three-layer KYC enforcement pattern, the project delivers a reference architecture that is simultaneously **legally enforceable** (contractual finality + `forcedTransfer`), **operationally efficient** (EIP-1167 proxies, shared identity, off-chain policy), and **regulator-examinable** (on-chain 98/2 dashboard, audit events, reproducible deployment).

Against the commercial competitive landscape — Tokeny, Polymesh, Securitize, ADDX, INX, tZERO, BondbloX, HashKey, OSL and Hex Trust — TokenHub uniquely integrates all of these attributes in an **open, academically reproducible** artefact aligned to Hong Kong law. This is the property that makes the project distinctive: not any single component in isolation, but the coherent end-to-end stack that a regulator, an issuer, or a subsequent research team can inspect, fork and extend.

The work satisfies the seven original project objectives (automated compliance, fractional ownership, faster mobilisation, instant settlement, lower cost, secondary-market activation, and secure token management) and lays concrete foundations for the remaining roadmap — Project Ensemble integration, third-party audit, dividend distribution, and formal verification — that would take TokenHub from capstone prototype to production-ready infrastructure for the HKSTP ecosystem.

---

## 15. References

**Hong Kong Law and Regulation**

1. Securities and Futures Ordinance (Cap. 571).
2. Anti-Money Laundering and Counter-Terrorist Financing Ordinance (Cap. 615).
3. Companies Ordinance (Cap. 622).
4. Companies (Winding Up and Miscellaneous Provisions) Ordinance (Cap. 32), s. 182.
5. Payment Systems and Stored Value Facilities Ordinance / Clearing and Settlement Systems Ordinance (Cap. 584).
6. SFC, *Circular on Tokenisation of SFC-Authorised Investment Products* (2 Nov 2023).
7. SFC, *Statement on Security Token Offerings* (28 Mar 2019).
8. SFC, *Virtual Asset Trading Platform Operators — Conduct Standards* (last update 16 Jan 2025).
9. SFC, *Guideline on Anti-Money Laundering and Counter-Financing of Terrorism for LCs and SFC-licensed VASPs* (Jun 2023).
10. HKMA, *Project Ensemble press release* (7 Mar 2024); *extension to real-value transactions* (13 Nov 2025).
11. HKMA, *e-HKD Pilot Programme Phase 2 Report*.
12. FATF Recommendation 16 — Travel Rule for virtual-asset transfers.

**Token Standards and Technical References**

13. ERC-3643 / T-REX — [docs.erc3643.org](https://docs.erc3643.org/erc-3643).
14. ERC-1644 — Controller Token Operation Standard, EIP Issue #1644.
15. ERC-734 / ERC-735 — ONCHAINID key and claim management.
16. ERC-1167 — Minimal Proxy Standard.
17. EIP-712 — Structured Data Hashing and Signing.
18. ERC-1967 — Upgradeable Proxy Storage Slots.
19. OpenZeppelin Contracts v5 — Governance, AccessControl, ERC20Votes, TimelockController.
20. Chainlink, *What Is Atomic Settlement? On-chain DvP Explained*.
21. BondbloX, *The Alchemy of Atomic Settlement*.

**Project Artefacts**

22. TokenHub Interim Report — [Interim_Report.md](Interim_Report.md).
23. Regulatory Feasibility — [Regulatory_Feasibility.md](Regulatory_Feasibility.md).
24. Tiered Minting Safeguard — [Safeguard.md](Safeguard.md).
25. Corporate Actions — [CorporateAction.md](CorporateAction.md).
26. Token Management — [TokenManagement.md](TokenManagement.md).
27. Tokenhub Launch Guide — [Tokenhub_Launch.md](Tokenhub_Launch.md).
28. Codespaces Deployment — [CodeSpace_deployment.md](CodeSpace_deployment.md).
29. Alignment Review (Spec vs Implementation) — [Alignment_Review_v2.md](Alignment_Review_v2.md).
30. Slither Static Analysis Report — [SLITHER-REPORT.md](SLITHER-REPORT.md).
31. Frontend Test Cases — [frontend/FRONTEND-TEST-CASES.md](frontend/FRONTEND-TEST-CASES.md).

---

*Prepared in partial fulfilment of the requirements of the degree of Master of Science in Financial Technology and Data Analytics, The University of Hong Kong, April 2026.*
