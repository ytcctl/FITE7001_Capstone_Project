# Executive Summary

**Project Title:** TokenHub — Permissioned Security Token Platform for HKSTP Startup Equity Tokenization  
**Course:** FITE 7001 Capstone Project  
**Date:** April 2026  

---

## 1. Project Background and Motivation

Hong Kong Science & Technology Parks Corporation (HKSTP) provides office space, funding, and support services to an extensive portfolio of technology startups. A persistent challenge is that equity stakes in these early-stage companies are highly illiquid: there is no secondary market, transfers are paper-intensive, and fractional ownership is practically impossible. This illiquidity raises the cost of capital for startups and limits exit options for early investors.

Simultaneously, the Hong Kong Securities and Futures Commission (SFC) has been actively developing a regulatory framework for digital assets, including the Virtual Asset Trading Platform (VATP) licensing regime (effective June 2023), updated conduct standards for custodial safekeeping (January 2025), and principles for tokenized securities. These developments create a regulatory pathway for a legally compliant, blockchain-based equity token platform operating within the Hong Kong jurisdiction.

**TokenHub** was conceived to bridge this gap — providing an end-to-end permissioned security token infrastructure that enables HKSTP startups to issue fractional equity tokens, allows verified institutional and accredited investors to trade them on a regulated secondary market, and enforces applicable legal constraints automatically through smart contract logic.

---

## 2. Project Objectives

The project set out to deliver the following five objectives:

| # | Objective | Outcome |
|---|-----------|---------|
| 1 | Design and deploy an ERC-3643 (T-REX) inspired security token with on-chain KYC/AML enforcement | ✅ Delivered — `HKSTPSecurityToken` with full compliance pipeline |
| 2 | Build a permissioned order-book trading engine with automatic matching and atomic settlement | ✅ Delivered — `OrderBook` + `DvPSettlement` with T+0 clearing |
| 3 | Implement a multi-oracle compliance attestation system to eliminate single-point-of-failure risk | ✅ Delivered — `OracleCommittee` with 2-of-N EIP-712 threshold |
| 4 | Create a governance framework that subjects critical administrative actions to token-holder voting | ✅ Delivered — `HKSTPGovernor` + `HKSTPTimelock` with Timelock-controlled execution |
| 5 | Develop a fully functional investor portal covering all four operational roles | ✅ Delivered — React/TypeScript frontend with role-based access |

---

## 3. System Architecture

TokenHub is structured in five interdependent layers:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     INVESTOR PORTAL  (React / Vite / TypeScript)         │
│  Role-based UI — Admin · Agent · Operator · Investor                    │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │ ethers.js / browser wallet
┌────────────────────────────▼─────────────────────────────────────────────┐
│               COMPLIANCE & ORACLE LAYER                                  │
│  OracleCommittee (2-of-N EIP-712) · HKSTPCompliance (module pipeline)   │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────────────┐
│               TOKEN & IDENTITY LAYER                                     │
│  HKSTPSecurityToken (ERC-3643 / ERC-20Votes) · MockCashToken (THKD)     │
│  HKSTPIdentityRegistry · ClaimIssuer · IdentityFactory                  │
│  TokenFactory (EIP-1167) · TokenFactoryV2 (ERC-1967)                    │
└────────────────────────────┬─────────────────────────────────────────────┘
                             │
┌──────────────┬─────────────▼──────────┬─────────────────────────────────┐
│ TRADING LAYER│   SETTLEMENT LAYER     │         CUSTODY LAYER           │
│ OrderBook    │   DvPSettlement        │  WalletRegistry · MultiSigWarm  │
│ OrderBook-   │   (atomic T+0 swap)    │  Hot / Warm / Cold tiers        │
│ Factory      │                        │  98/2 SFC requirement           │
└──────────────┴────────────────────────┴─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────────────────┐
│               GOVERNANCE LAYER                                           │
│  HKSTPGovernor (OZ Governor) · HKSTPTimelock · GovernorFactory          │
│  Proposal → Vote → Queue → Execute (48h Timelock delay)                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Smart Contract Inventory

The platform is composed of **21 Solidity contracts** across six functional domains:

| Domain | Contracts | Purpose |
|--------|-----------|---------|
| **Token** | `HKSTPSecurityToken`, `TokenFactory`, `TokenFactoryV2`, `MockCashToken` | ERC-3643 security tokens (V1 immutable clones / V2 upgradeable proxies) and tokenized HKD cash |
| **Identity & KYC** | `HKSTPIdentityRegistry`, `Identity`, `IdentityFactory`, `ClaimIssuer`, `IIdentity`, `IClaimIssuer` | ONCHAINID-compatible (ERC-734/735) per-investor identity contracts with typed KYC/AML claims |
| **Compliance** | `HKSTPCompliance`, `OracleCommittee` | Modular compliance pipeline (jurisdiction, concentration caps, lock-up, oracle attestation) with 2-of-N multi-oracle verification |
| **Trading & Settlement** | `OrderBook`, `OrderBookFactory`, `DvPSettlement` | On-chain limit order book with automatic price-time-priority matching and atomic Delivery-versus-Payment settlement |
| **Custody** | `WalletRegistry`, `MultiSigWarm` | Three-tier (Hot/Warm/Cold) custody wallet system with on-chain AUM tracking, hot-cap enforcement, and 2-of-3 multi-signature warm wallet |
| **Governance** | `HKSTPGovernor`, `HKSTPTimelock`, `GovernorFactory` | OpenZeppelin Governor with configurable voting parameters, per-token governance deployment, and Timelock-controlled execution |
| **Utilities** | `SystemHealthCheck` | On-chain deployment wiring and health verification |

### 3.2 Frontend Architecture

The investor portal is built with **React 18 / TypeScript / Vite** and **TailwindCSS**. It implements role-based access across four operational roles — **Admin**, **Agent**, **Operator**, and **Investor** — and exposes 14 distinct functional pages covering the full token lifecycle from issuance to governance.

The frontend interacts directly with the blockchain via **ethers.js v6** and supports three wallet connection modes: built-in test accounts (development), MetaMask browser extension, and custom private key entry. No centralised backend is required for core operations — all state lives on-chain.

---

## 4. Key Features and Technical Contributions

### 4.1 ERC-3643 (T-REX) Security Token

`HKSTPSecurityToken` is an ERC-20 token extended with:

- **Compliance-gated transfers** — every `_update()` call (transfer, mint, burn) is routed through the `HKSTPCompliance.checkModules()` pipeline. Non-compliant transfers revert atomically.
- **Identity-gated operations** — sender and recipient addresses are verified against the `HKSTPIdentityRegistry` (KYC-verified status) before any token movement is permitted.
- **Tiered minting control** — small mints execute directly via `AGENT_ROLE`; mints exceeding a configurable threshold require the `TIMELOCK_MINTER_ROLE` held by the Timelock, enforcing a governance vote for large issuances.
- **On-chain governance** — inherits `ERC20Votes` (EIP-5805), enabling checkpoint-based voting power for on-chain proposals. Snapshot resistance prevents flash-loan governance attacks.
- **Emergency controls** — `pause()` halts all token operations; `setAddressFrozen()` blocks individual addresses; `forcedTransfer()` (ERC-1644) enables court-ordered asset recovery.
- **Supply safeguards** — configurable `maxSupply` hard cap and `mintThreshold` governance gate.
- **Proxy compatibility** — uses `initialize()` instead of a constructor for EIP-1167 clone and ERC-1967 proxy deployment.

### 4.2 ONCHAINID-Compatible Identity Registry

`HKSTPIdentityRegistry` manages per-investor identity state:

- Each investor may have a dedicated **Identity contract** (ERC-734/735 ONCHAINID standard) or a simpler boolean flag, depending on the registration mode chosen by the Agent.
- **Typed KYC claims** (Topics 1–6: KYC Verified, Accredited Investor, Jurisdiction Approved, Source of Funds, PEP/Sanctions Clear, FPS Name-Match) are issued on-chain and verified cryptographically.
- Multi-wallet support: multiple addresses can be linked to one identity, enabling investors to manage tokens across cold and hot wallets while sharing a single compliance profile.
- `isVerified()` aggregates all claim checks into a single boolean consulted by the token and order book.

### 4.3 Modular Compliance Engine

`HKSTPCompliance` implements a composable module pipeline applied to every transfer and mint:

| Module | Rule Enforced |
|--------|--------------|
| **Jurisdiction** | Restricts token transfers to/from addresses registered in whitelisted country codes |
| **Concentration Cap** | Enforces per-investor and global token holding limits (Companies Ordinance Cap. 622 shareholder cap) |
| **Lock-Up Period** | Prevents token sales before a configurable unlock date (founder vesting, IPO quiet periods) |
| **Oracle Attestation** | Validates EIP-712 multi-oracle compliance attestations (future AML/sanctions screening integration) |

### 4.4 On-Chain Order Book with Atomic Settlement

`OrderBook` implements a **price-time-priority** limit order book fully on-chain:

- Investors place limit buy and sell orders specifying price and quantity.
- Incoming orders are auto-matched against resting orders on the opposite side (best price first, then earliest timestamp).
- Partial fills are supported — remaining unfilled quantity stays on the book.
- Matched trades are settled atomically via `DvPSettlement` — both security tokens and THKD cash tokens transfer in a single, atomic EVM transaction. If either leg fails, the entire settlement reverts: zero settlement risk.
- The order book requires `identityRegistry.isVerified(trader)` before accepting orders — unverified investors are rejected at placement time.
- The `OrderBookFactory` deploys one independent `OrderBook` per token pair and maintains an on-chain registry of all active markets.

### 4.5 Multi-Oracle Compliance Committee

`OracleCommittee` eliminates the single-oracle vulnerability inherent in ERC-3643 reference implementations:

- A configurable committee of up to 5 oracle members, each holding `ORACLE_ROLE`
- A configurable threshold (minimum 2) of valid EIP-712 signatures required to approve a compliance attestation
- If any single oracle key is compromised, the attacker cannot forge attestations without reaching the threshold
- If a single oracle goes offline, the remaining members maintain service continuity
- Oracle membership and threshold changes require `DEFAULT_ADMIN_ROLE`, which is transferred to the Timelock after production hardening

### 4.6 On-Chain Governance

`HKSTPGovernor` and `HKSTPTimelock` implement a full OpenZeppelin Governor governance system:

| Parameter | Production Configuration |
|-----------|------------------------|
| Voting Delay | 48 hours (2 days) |
| Voting Period | 7 days |
| Quorum | 10% of total token supply |
| Proposal Threshold | 10,000 tokens (1% of standard 1M supply) |
| Timelock Delay | 48 hours |

Critical administrative operations — including large token mints, oracle membership changes, and implementation upgrades — are gated behind the governance process. After production hardening (`scripts/harden-admin.js`), the deployer EOA relinquishes `DEFAULT_ADMIN_ROLE` to the Timelock, making all platform-level changes subject to token-holder voting.

### 4.7 Three-Tier Custody Architecture

`WalletRegistry` and `MultiSigWarm` implement a custody architecture aligned with SFC VATP requirements:

- **Hot Wallet** (< 2% AUM): always-online, instant operations; on-chain hot cap in basis points triggers an automated `SweepRequired` event when exceeded
- **Warm Wallet** (transient): 2-of-3 multi-signature contract for rebalancing; proposals require confirmation from independent signers before execution
- **Cold Wallet** (≥ 98% AUM): air-gapped, physically secured; cold transfer blocking enforced on-chain with `ColdTransferBlocked` events
- Multi-token AUM calculation tracks balances across all registered security tokens and THKD

### 4.8 Corporate Action Support

The platform natively supports corporate-action workflows through its token and governance design:

- **Book close / Record date** — replaced by `ERC20Votes` checkpoint snapshots; `getPastVotes()` returns frozen balances at any historical timestamp
- **Global pause** — `pause()` blocks all transfers during regulatory halt or maintenance windows
- **Per-address freeze** — `setAddressFrozen()` / `forcedTransfer()` handle sanctions, PEP flags, and court orders
- **Rights preservation** — votes and governance rights are checkpoint-based, immune to post-snapshot transfers

---

## 5. Security Analysis

A **Slither v0.11.5** static analysis was performed across all 12 TokenHub contracts (77 contracts including OpenZeppelin dependencies, 58 detectors). Four high-severity findings were identified and resolved:

| Finding | Contract | Resolution |
|---------|----------|-----------|
| Locked ETH — no withdrawal function | `MultiSigWarm` | Added `withdrawETH()` gated by `DEFAULT_ADMIN_ROLE` |
| Reentrancy (state written after external call) | `TokenFactory` | Reordered to Checks-Effects-Interactions (CEI) pattern |
| Reentrancy (state written after external call) | `IdentityFactory` | Reordered to CEI pattern |
| Reentrancy (low risk, role-gated) | `HKSTPIdentityRegistry` | Accepted risk — mitigated by `DEPLOYER_ROLE` restriction |

All medium-severity findings were reviewed and accepted as intentional patterns (strict enum equality, default-initialized local variables, partially consumed return values).

Residual risk areas are documented with a roadmap for formal verification (Certora Prover), Foundry fuzz testing, and a third-party audit (Trail of Bits / OpenZeppelin) before any mainnet deployment.

---

## 6. Testing

The project includes a comprehensive automated test suite across **12 test files**:

| Test File | Coverage Area |
|-----------|---------------|
| `HKSTPSecurityToken.test.js` | Token lifecycle — mint, burn, transfer, pause, freeze, compliance gate |
| `HKSTPCompliance.test.js` | Jurisdiction, concentration cap, lock-up, module pipeline |
| `Identity.test.js` | ONCHAINID registration, claim issuance, multi-wallet linking |
| `DvPSettlement.test.js` | Atomic settlement, pre-flight checks, expiry, cancellation |
| `Governance.test.js` | Proposal creation, voting, quorum, Timelock queue and execution |
| `TokenFactory.test.js` | V1 clone deployment, V2 proxy upgrade, CEI reentrancy guard |
| `OracleCommittee.test.js` | Multi-oracle threshold, EIP-712 signature aggregation |
| `WalletArchitecture.test.js` | Hot/Warm/Cold registration, AUM calculation, MultiSig lifecycle |
| `ShareholderCap.test.js` | Cap. 622 50-shareholder cap enforcement |
| `AML.test.js` | AML freeze, forced transfer, audit trail |
| `ActionPlan.test.js` | End-to-end workflow scenarios |
| `besu-e2e.test.js` | Hyperledger Besu integration test (production-like network) |

---

## 7. Deployment Architecture

TokenHub supports two blockchain environments:

| Environment | Technology | Use Case |
|-------------|------------|---------|
| **Development** | Hardhat/Anvil (local EVM, Chain ID 31337) | Local development, testing, demonstration |
| **Production-like** | Hyperledger Besu IBFT2 (4-validator permissioned network) | Pre-production, regulatory sandbox |

Deployment is fully automated via `scripts/deploy-and-update-frontend.js`, which deploys all 21 contracts, configures role grants, wires governance, and updates the frontend contract address registry in a single script execution.

A state snapshot mechanism (`anvil_loadState`) supports rapid demonstration setup by restoring a pre-seeded blockchain state including deployed contracts, registered investors, and existing trade history.

The frontend supports remote access via **VS Code Dev Tunnels** (with HMR disabled for stability), enabling cross-location demonstration without additional infrastructure.

---

## 8. Regulatory Alignment

TokenHub's design maps explicitly to Hong Kong regulatory requirements:

| Requirement | Source | Implementation |
|-------------|--------|---------------|
| KYC/AML identity verification before token trading | SFC VATP Licensing Conditions | `HKSTPIdentityRegistry` + `ClaimIssuer` (ERC-735 claims Topics 1–6) |
| 98/2 cold-to-hot custody ratio | SFC Conduct Standards for VATPs (Jan 2025) | `WalletRegistry` hot cap + `MultiSigWarm` |
| 50-shareholder cap for private companies | HK Companies Ordinance Cap. 622 | `HKSTPCompliance` shareholder count module |
| Governance voting before large-scale token issuance | Principle of investor protection | `HKSTPGovernor` + `TIMELOCK_MINTER_ROLE` |
| Atomic delivery-versus-payment | Securities settlement best practice (DTCC/BIS) | `DvPSettlement` single-transaction swap |
| Jurisdiction-based transfer restrictions | SFC territorial licensing | `HKSTPCompliance` jurisdiction module |
| Immutable audit trail | General regulatory record-keeping | On-chain events for every transfer, mint, freeze, and settlement |
| Emergency halt capability | SFC regulatory directions | `pause()` on token and settlement; per-address freeze |

---

## 9. Limitations and Future Work

### Current Limitations

- The platform currently operates on a local Ethereum-compatible chain (Anvil/Hardhat) rather than a public or permissioned mainnet. A production deployment would require a formal third-party security audit, regulatory engagement with the SFC, and integration with live identity providers and KYC vendors.
- `MockCashToken` (THKD) is a placeholder ERC-20. A production deployment would use a regulated tokenized Hong Kong dollar, such as a licensed stablecoin or a bank-issued deposit token.
- The oracle compliance attestation is currently signed by simulated oracle keys. Production integration would connect to licensed AML/KYC data providers (e.g., Refinitiv World-Check, Chainalysis) as oracle nodes.
- The order book is fully on-chain, which is gas-intensive. A production-scale system may benefit from an off-chain matching engine with on-chain settlement (a hybrid architecture common in regulated DEX designs).

### Future Enhancements

1. **Formal Verification** — Certora Prover invariants for total supply consistency and shareholder cap correctness
2. **Foundry Fuzz Testing** — boundary condition testing for order-book matching, compliance edge cases, and governance parameter manipulation
3. **Third-Party Audit** — Trail of Bits or OpenZeppelin audit before any public deployment
4. **Real-World KYC Integration** — Webhook-driven claim issuance from a licensed KYC provider (e.g., SumSub, Onfido)
5. **Cross-Chain Bridge** — ERC-3643 bridge to allow HKSTP tokens to be held on Ethereum mainnet or a Layer-2 while settling on the permissioned chain
6. **SFC Sandbox Engagement** — Submission to SFC's Fintech Supervisory Sandbox (FSS) to validate the regulatory interpretation
7. **Dividend Distribution** — On-chain distribution module using `getPastTotalSupply()` and `getPastVotes()` for pro-rata dividend payments

---

## 10. Conclusion

TokenHub demonstrates the technical feasibility of a fully compliant, production-grade security token platform tailored to Hong Kong's regulatory environment and the specific characteristics of HKSTP startup equity. By combining ERC-3643 security token standards, ONCHAINID-based KYC, on-chain order-book trading, atomic DvP settlement, multi-oracle compliance attestation, Timelock-governed administration, and an SFC-aligned three-tier custody model, the project delivers a comprehensive proof-of-concept spanning the entire security token lifecycle — from initial token issuance to secondary market trading, settlement, and governance.

The system was built to production engineering standards: modular smart contracts following the Checks-Effects-Interactions pattern, OpenZeppelin v5 battle-tested primitives, static analysis with all high-severity issues resolved, a 12-file automated test suite, and a complete role-based user interface with four end-user manuals. It provides a credible architectural foundation for future engagement with the SFC regulatory sandbox and commercial deployment on a permissioned enterprise blockchain.

---

*Prepared for FITE 7001 Capstone Project · The University of Hong Kong · April 2026*
