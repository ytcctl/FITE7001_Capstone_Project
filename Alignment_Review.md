# Architecture Alignment Review

**Comparison of the Repository Implementation vs. the Interim Architecture Specification (`tokenhub_architecture_Interim.md`)**

This document systematically compares every architectural component described in the TokenHub Interim Architecture Specification against the actual smart-contract code and frontend implementation in this repository, highlighting alignments and misalignments.

---

## Table of Contents

1. [Custodial Wallet Architecture (Hot / Warm / Cold)](#1-custodial-wallet-architecture-hot--warm--cold)
2. [Permissioned Ledger & Transfer Compliance](#2-permissioned-ledger--transfer-compliance)
3. [forcedTransfer() Protocol](#3-forcedtransfer-protocol)
4. [ERC-3643 (T-REX) Token Standard](#4-erc-3643-t-rex-token-standard)
5. [Identity Registry & ONCHAINID](#5-identity-registry--onchainid)
6. [Gas Optimisation Strategies](#6-gas-optimisation-strategies)
7. [Governance Voting Contract](#7-governance-voting-contract)
8. [Minting / Burning Logic](#8-minting--burning-logic)
9. [Atomic DvP Settlement](#9-atomic-dvp-settlement)
10. [Deposit / Withdrawal Workflow (FPS)](#10-deposit--withdrawal-workflow-fps)
11. [Order Book / Trading Engine](#11-order-book--trading-engine)
12. [Oracle Committee & EIP-712 Attestations](#12-oracle-committee--eip-712-attestations)
13. [System Health & Diagnostics](#13-system-health--diagnostics)
14. [Summary Matrix](#14-summary-matrix)

---

## 1. Custodial Wallet Architecture (Hot / Warm / Cold)

### Interim Architecture Specifies

| Aspect | Specification |
|---|---|
| Three wallet tiers | Hot (< 2%, always online), Warm (transient buffer, 2-of-3 multi-sig), Cold (> 98%, air-gapped) |
| 98/2 Requirement | At least 98% of client assets in cold storage |
| Automated sweep | Real-time sweep of excess hot-wallet funds to cold |
| FIPS 140-2 Level 3+ HSM | Cold wallet keys stored in certified HSMs in Hong Kong |
| Air-gapped signing workflow | QR-code / quarantined USB transfer, offline signing |
| Disruption recovery | 12-hour restoration window |

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `WalletRegistry.sol` | ✅ Aligned | Implements `HOT`, `WARM`, `COLD` enum tiers; enforces 2% hot-cap via `hotCapBps` (default 200 bps); `isHotOverCap()` detection; `checkAndEmitSweep()` event for off-chain custody service |
| `MultiSigWarm.sol` | ✅ Aligned | 2-of-3 (configurable M-of-N) multi-sig for warm wallet; 48-hour proposal expiry |
| Cold wallet transfer block | ✅ Aligned | `canTransferFrom()` rejects COLD tier wallets on-chain, enforcing air-gapped-only signing |
| AUM tracking | ✅ Aligned | `totalAUM()`, `hotBalance()`, `warmBalance()`, `coldBalance()` per tracked token |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 1.1 | **HSM Integration** | The spec mandates FIPS 140-2 Level 3+ HSM integration. The repo has no HSM-specific code or off-chain service stub. This is expected since HSM integration is an infrastructure-layer concern, but no documentation or configuration exists in the repo to guide HSM setup. |
| 1.2 | **Air-gapped signing workflow** | The spec describes a detailed QR-code / USB-based air-gap protocol. The repo blocks cold transfers on-chain but provides no tooling (scripts, QR encoder, etc.) for the air-gapped signing ceremony. |
| 1.3 | **Disruption recovery** | The 12-hour restoration SLA is a policy commitment with no corresponding implementation or documentation in the repo. |

---

## 2. Permissioned Ledger & Transfer Compliance

### Interim Architecture Specifies

- Every transfer intercepted by a compliance layer validating identity and eligibility.
- Four ledger state components: Token Contract, Identity Registry, Compliance Contract, Claim Topics Registry.
- Transfer flow: Initiation → Eligibility Check (IdentityRegistry) → Compliance Check → Balance Check → Execution or Revert.
- Rejection of self-custody: only custodian-managed addresses whitelisted.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPSecurityToken.sol` transfer override | ✅ Aligned | `_update()` override calls `identityRegistry.isVerified()` for both sender and receiver; checks freeze status, shareholder cap (Cap. 622), compliance modules |
| `HKSTPCompliance.sol` | ✅ Aligned | Modular compliance checks: lock-up period, jurisdiction whitelist/blacklist, per-investor and global concentration caps; EIP-712 attestation verification |
| `HKSTPIdentityRegistry.sol` | ✅ Aligned | Maps addresses to ONCHAINID; `isVerified()` checks required claim topics from trusted issuers; multi-wallet linking for Sybil-proof holder counting |
| Safe-list mechanism | ✅ Aligned | `setSafeList()` whitelists operational addresses (treasury, escrow, custody) that bypass attestation but still require basic verification |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 2.1 | **Claim Topics Registry as separate contract** | The spec describes a dedicated "Claim Topics Registry" contract. In the repo, claim topics management is embedded within `HKSTPIdentityRegistry.sol` (via `setRequiredClaimTopics()` / `requiredClaimTopics`), not deployed as a standalone contract. This is a simplification, not a functional gap. |
| 2.2 | **Trusted Issuers Registry as separate contract** | Similarly, the spec implies a standalone "Trusted Issuers Registry". The repo handles trusted issuers inside `HKSTPIdentityRegistry.sol` (`addTrustedIssuer()` / `removeTrustedIssuer()`). Again a simplification that consolidates functionality. |

---

## 3. forcedTransfer() Protocol

### Interim Architecture Specifies

- ERC-1644 (Controller Token Operation) standard.
- Signature: `forcedTransfer(address _from, address _to, uint256 _amount, bytes _data, bytes _operatorData)`.
- Protected by `onlyAgent` modifier.
- Bypasses `canTransfer()` compliance check.
- Receiver `_to` must still be verified in IdentityRegistry.
- Emits `ControllerTransfer` (or `ForcedTransfer`) event.
- `_operatorData` stores IPFS CID pointing to encrypted court order.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPSecurityToken.forcedTransfer()` | ⚠️ Partially Aligned | Function exists with `AGENT_ROLE` protection; bypasses standard compliance checks; emits `ForcedTransfer` event with legal order hash |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 3.1 | **Function signature differs** | The spec uses `(address _from, address _to, uint256 _amount, bytes _data, bytes _operatorData)`. The repo uses `(address from, address to, uint256 amount, bytes32 legalOrderHash, bytes calldata operatorData)`. The `_data` parameter is replaced by a typed `bytes32 legalOrderHash`, and `_operatorData` remains as `bytes`. This is arguably an improvement (strongly-typed hash vs. raw bytes) but diverges from the ERC-1644 function signature. |
| 3.2 | **Receiver identity verification** | The spec requires the `_to` address to be a verified identity. The actual `forcedTransfer()` bypasses all compliance checks including identity verification, meaning tokens could be forced to an unverified address. This is a functional misalignment. |
| 3.3 | **Event name** | The spec says `ControllerTransfer` (ERC-1644 standard event). The repo emits `ForcedTransfer`. This breaks compatibility with tooling that listens for the ERC-1644 canonical event. |

---

## 4. ERC-3643 (T-REX) Token Standard

### Interim Architecture Specifies

- Core standard is ERC-3643 (T-REX) for compliance-by-design security tokens.
- Composition: Token Contract + Identity Registry + Compliance Module + Claim Topics Registry + Trusted Issuers Registry.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPSecurityToken.sol` | ⚠️ Partially Aligned | Implements ERC-20, ERC-20 Permit, ERC-20 Votes, and a T-REX-*inspired* compliance-gated transfer pattern, but does **not** implement the canonical ERC-3643 interface (`IToken` from the T-REX protocol SDK) |
| Five-contract architecture | ⚠️ Partially Aligned | The spec's five-contract architecture (Token, Identity Registry, Compliance, Claim Topics Registry, Trusted Issuers Registry) is reduced to three contracts in the repo: `HKSTPSecurityToken`, `HKSTPIdentityRegistry` (absorbs Claim Topics + Trusted Issuers), `HKSTPCompliance` |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 4.1 | **Not canonical ERC-3643** | The token does not expose the canonical T-REX interfaces (`IToken`, `IIdentityRegistry`, `ICompliance`, `IClaimTopicsRegistry`, `ITrustedIssuersRegistry`). It is a bespoke implementation inspired by T-REX principles rather than a conforming ERC-3643 deployment. External tooling expecting standard T-REX ABIs would not interoperate. |
| 4.2 | **Consolidated registries** | As noted in Section 2, Claim Topics Registry and Trusted Issuers Registry are folded into `HKSTPIdentityRegistry`. This simplifies deployment but breaks the T-REX modular composability pattern. |

---

## 5. Identity Registry & ONCHAINID

### Interim Architecture Specifies

- ONCHAINID (ERC-734/735) for on-chain identity management.
- Claim-based verification: KYC, Accredited Investor, Jurisdiction, Source-of-Funds, PEP/Sanctions.
- Privacy-preserving (no personal data on-chain).
- Multi-wallet identity linking for Cap. 622 shareholder deduplication.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `Identity.sol` | ✅ Aligned | Full ERC-734 key management + ERC-735 claim holder; EIP-1167 clonable |
| `IdentityFactory.sol` | ✅ Aligned | Gas-efficient EIP-1167 clone deployment of Identity contracts |
| `ClaimIssuer.sol` | ✅ Aligned | Trusted issuer with signing key, claim validation, revocation |
| `HKSTPIdentityRegistry.sol` | ✅ Aligned | `isVerified()` with dual-mode (ONCHAINID claims or boolean fallback); 6 claim topics (KYC, Accredited, Jurisdiction, Source-of-Funds, PEP/Sanctions, FPS Name-Match); multi-wallet linking; CDD record anchoring (AMLO s.22); STR filing (AMLO s.25A) |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 5.1 | **Claim Topic 6 (FPS Name-Match)** | The spec lists 5 claim topics. The repo adds a 6th topic: "FPS Name-Match Verified". This is an enhancement, not a gap, but it is undocumented in the interim spec. |
| 5.2 | **CDD / STR on-chain anchoring** | The repo includes `anchorCDDRecord()` and `reportSuspiciousActivity()` for AMLO compliance — features not described in the interim architecture at all. These are enhancements. |

---

## 6. Gas Optimisation Strategies

### Interim Architecture Specifies

| Strategy | Specification |
|---|---|
| EIP-1167 Minimal Proxy | ~90% gas savings for token deployment; each startup gets independent address/storage sharing logic bytecode |
| Shared Identity Registry Storage | Central `IdentityRegistryStorage` reduces redundant KYC writes |
| EIP-712 Off-chain Signatures | Compliance oracle issues off-chain attestation; contract uses `ecrecover` (~3,000 gas) |

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `TokenFactory.sol` (EIP-1167) | ✅ Aligned | Uses `Clones.clone()` from OpenZeppelin to deploy `HKSTPSecurityToken` proxies |
| `IdentityFactory.sol` (EIP-1167) | ✅ Aligned | Uses `Clones.clone()` for `Identity` contracts |
| `TokenFactoryV2.sol` (ERC-1967) | ✅ Enhancement | Adds upgradeable proxy support via ERC-1967 for post-deployment vulnerability fixes — not in the spec but a practical addition |
| Shared Identity Registry | ✅ Aligned | All tokens share the same `HKSTPIdentityRegistry` instance (set via `TokenFactory.setInfrastructure()`) |
| EIP-712 Attestation | ✅ Aligned | `HKSTPCompliance.sol` uses EIP-712 typed-data signing for off-chain compliance oracle attestations |
| `OracleCommittee.sol` | ✅ Enhancement | Extends single-oracle to 2-of-3 multi-signature attestation — not in the spec but strengthens security |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 6.1 | **No standalone IdentityRegistryStorage** | The spec describes a physically separated "Identity Storage Layer" from the "Identity Registry". The repo uses a single `HKSTPIdentityRegistry` contract that handles both registry logic and storage. While this achieves the same shared-data goal, it does not follow the explicit two-contract separation described in the spec. |

---

## 7. Governance Voting Contract

### Interim Architecture Specifies

| Parameter | Value |
|---|---|
| Framework | OpenZeppelin Governor modified with ONCHAINID |
| Proposal threshold | 1% of total supply |
| Voting delay | 2 days |
| Voting period | 7 days |
| Quorum | 10% of total supply |
| Timelock | 48 hours |
| Identity-locked voting | KYC expiry revokes voting right mid-vote |
| Flash-loan resistance | Snapshot-based voting power |

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPGovernor.sol` | ✅ Aligned | OpenZeppelin Governor with `GovernorSettings`, `GovernorCountingSimple`, `GovernorVotesQuorumFraction`, `GovernorTimelockControl`; identity-locked `castVote()` checks `identityRegistry.isVerified(voter)` |
| `HKSTPTimelock.sol` | ✅ Aligned | `TimelockController` with proposer/executor/canceller roles |
| `GovernorFactory.sol` | ✅ Enhancement | Per-token governance registry (not described in spec) |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 7.1 | **Default timelock delay** | The spec says 48 hours. The repo's `HKSTPTimelock` defaults to 1 block for testing. Production deployment scripts should configure this to 48 hours (172,800 seconds), but no deployment script enforces or validates this production value. |
| 7.2 | **Governance parameters source** | Governor parameters (voting delay, period, threshold, quorum) are set at construction time. The repo hardcodes test-friendly values in deploy scripts rather than production values specified in the architecture. A production deployment checklist is missing. |

---

## 8. Minting / Burning Logic

### Interim Architecture Specifies

- Only Agent (licensed custodian) can mint/burn.
- "CanCreate" pre-check before minting (KYC/AML verification, supply cap).
- Atomic minting within DvP settlement.
- Recovery: burn lost-wallet tokens + mint to new verified wallet.
- `recoveryAddress()` map for identity-to-wallet tracking.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `mint()` | ✅ Aligned (enhanced) | Tiered minting: ≤ threshold requires `AGENT_ROLE`; > threshold requires `TIMELOCK_MINTER_ROLE` (governance). Identity verification on recipient. Max supply enforcement. |
| `burn()` | ✅ Aligned | `AGENT_ROLE` required. |
| Atomic DvP mint | ✅ Aligned | `DvPSettlement.sol` integrates token transfers atomically |
| Recovery | ⚠️ Partially Aligned | The pattern of burn-from-lost + mint-to-new is possible via Agent's `burn()` + `mint()` but there is no dedicated `recoverTokens()` function or `recoveryAddress()` mapping as described in the spec. |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 8.1 | **No dedicated recovery function** | The spec describes a specific recovery workflow with a `recoveryAddress()` map. The repo relies on the Agent manually calling `burn()` then `mint()` as separate transactions. There is no atomic recovery function and no on-chain mapping of identity to recovery address. |
| 8.2 | **Tiered minting not in spec** | The repo introduces a `mintThreshold` + `TIMELOCK_MINTER_ROLE` governance gate for large mints. This is an enhancement not described in the spec. |

---

## 9. Atomic DvP Settlement

### Interim Architecture Specifies

- Dual-token custody: Asset Leg (security token) + Payment Leg (tokenized cash).
- Atomic settlement: both legs succeed or entire transaction reverts.
- T+0 settlement cycle.
- Pre-trade compliance verification.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `DvPSettlement.sol` | ✅ Aligned | `createSettlement()` + `executeSettlement()` with atomic dual-leg transfer; pre-flight compliance checks (KYC, freeze, lock-up, balance); batch settlement support (up to 50); `Failed` status for non-reverting soft failures |
| Travel Rule | ✅ Enhancement | `setTravelRuleData()` for FATF Rec. 16 compliance — not in the spec |
| `MockCashToken.sol` | ✅ Aligned | Simulates tokenized HKD for the payment leg |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 9.1 | **No real tokenized-deposit integration** | The spec references Project Ensemble and tokenized deposits from commercial banks. The repo uses `MockCashToken` only. This is expected for a development/test environment, but no integration stub or interface for real tokenized deposits exists. |

---

## 10. Deposit / Withdrawal Workflow (FPS)

### Interim Architecture Specifies

- FPS-based deposit: investor pays via FPS QR code → payment notification → mint digital HKD.
- Closed-loop withdrawal: burn digital HKD → FPS payout to verified bank account.
- AML compliance check before withdrawal.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| FPS Integration | ❌ **Not Implemented** | There is no FPS integration code, webhook handler, QR code generator, or off-chain deposit/withdrawal service in the repository. |
| Cash token mint/burn | ⚠️ Partial | `MockCashToken` has `mint()` / `burn()` owned by a single account — suitable for testing but not a production FPS workflow. |
| Claim Topic 6 (FPS Name-Match) | ✅ Exists | The identity registry includes an FPS Name-Match claim topic, suggesting the design anticipates FPS integration, but no corresponding service implements it. |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 10.1 | **No FPS integration** | The deposit/withdrawal workflow described in the spec is entirely absent from the repo. This is a significant implementation gap — the full fiat on/off-ramp described in the architecture has no corresponding code. |
| 10.2 | **No withdrawal AML checks** | The spec describes AML checks before withdrawal. The `MockCashToken.burn()` has no compliance checks. |

---

## 11. Order Book / Trading Engine

### Interim Architecture Specifies

The interim architecture does **not** describe an on-chain order book or matching engine. It focuses on DvP settlement and assumes an off-chain matching layer.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `OrderBook.sol` | ✅ Enhancement | Full on-chain limit-order book with auto-matching, partial fills, buy/sell orders, escrow, and admin force-cancellation |
| `OrderBookFactory.sol` | ✅ Enhancement | One OrderBook per security token; shared cash token across all markets |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 11.1 | **Undocumented in spec** | The on-chain OrderBook and OrderBookFactory are significant components not mentioned in the interim architecture. The spec assumes off-chain matching. This is a positive enhancement but represents scope expansion beyond the documented architecture. |

---

## 12. Oracle Committee & EIP-712 Attestations

### Interim Architecture Specifies

- EIP-712 off-chain compliance signatures from a "Compliance Service".
- Single-oracle attestation model.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPCompliance.sol` | ✅ Aligned | EIP-712 structured data signing; single-oracle `verifyAttestation()` / `consumeAttestation()` with replay protection |
| `OracleCommittee.sol` | ✅ Enhancement | Extends to 2-of-3 (configurable N-of-M) multi-oracle verification; deduplication to prevent double-signing |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 12.1 | **OracleCommittee undocumented** | The multi-oracle committee is a significant security enhancement over the spec's single-oracle model but is not described in the interim architecture. |

---

## 13. System Health & Diagnostics

### Interim Architecture Specifies

Not described.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `SystemHealthCheck.sol` | ✅ Enhancement | Single-RPC-call diagnostics: wiring checks, admin role checks, operational checks, deployment checks across all contracts |

### Misalignments

| # | Area | Detail |
|---|---|---|
| 13.1 | **Undocumented** | `SystemHealthCheck` is a practical DevOps tool not mentioned in the interim architecture. |

---

## 14. Summary Matrix

| # | Architecture Domain | Interim Spec | Repo Status | Verdict |
|---|---|---|---|---|
| 1 | Hot/Warm/Cold Custody (98/2 rule) | ✅ Specified | ✅ Implemented | **Aligned** (HSM/air-gap tooling absent, as expected) |
| 2 | Permissioned Transfer Compliance | ✅ Specified | ✅ Implemented | **Aligned** (registries consolidated) |
| 3 | `forcedTransfer()` (ERC-1644) | ✅ Specified | ⚠️ Implemented | **Partially Aligned** — signature differs; receiver verification bypassed; non-standard event name |
| 4 | ERC-3643 (T-REX) Token Standard | ✅ Specified | ⚠️ Inspired | **Partially Aligned** — T-REX-inspired but not canonical ERC-3643 |
| 5 | ONCHAINID (ERC-734/735) Identity | ✅ Specified | ✅ Implemented | **Aligned** (+ enhancements) |
| 6 | Gas Optimisation (EIP-1167, shared registry, EIP-712) | ✅ Specified | ✅ Implemented | **Aligned** (no separate IdentityRegistryStorage) |
| 7 | Governance Voting (Governor + Timelock) | ✅ Specified | ✅ Implemented | **Aligned** (test defaults differ from production params) |
| 8 | Minting / Burning / Recovery | ✅ Specified | ⚠️ Implemented | **Partially Aligned** — no dedicated recovery function or `recoveryAddress()` map |
| 9 | Atomic DvP Settlement | ✅ Specified | ✅ Implemented | **Aligned** (no real tokenized deposit) |
| 10 | FPS Deposit / Withdrawal Workflow | ✅ Specified | ❌ Missing | **Not Implemented** |
| 11 | On-Chain Order Book | ❌ Not in spec | ✅ Implemented | **Enhancement** beyond spec |
| 12 | Oracle Committee (multi-sig attestation) | ❌ Not in spec | ✅ Implemented | **Enhancement** beyond spec |
| 13 | System Health Check | ❌ Not in spec | ✅ Implemented | **Enhancement** beyond spec |

---

## Key Findings

### Critical Misalignments (require attention)

1. **FPS Integration Missing (10.1)** — The entire fiat deposit/withdrawal workflow described in the spec has no implementation. This is the largest gap between the architecture document and the codebase.

2. **`forcedTransfer()` receiver verification bypassed (3.2)** — The spec explicitly requires the `_to` address to be verified. The implementation bypasses all compliance checks. A court-ordered transfer could move tokens to an unverified address, violating the permissioned custody model.

3. **No dedicated token recovery function (8.1)** — The spec describes a `recoveryAddress()` map and atomic recovery flow. The repo requires two separate manual transactions (burn + mint), which introduces risk of partial execution.

### Moderate Misalignments (acceptable with documentation)

4. **Not canonical ERC-3643 (4.1)** — The implementation is T-REX-inspired but custom. External T-REX tooling will not interoperate. If canonical ERC-3643 compliance is a regulatory requirement, this needs remediation.

5. **Consolidated registries (2.1, 2.2, 6.1)** — Claim Topics Registry, Trusted Issuers Registry, and Identity Storage are folded into `HKSTPIdentityRegistry`. Functionally equivalent but breaks T-REX modular composability.

6. **`forcedTransfer()` signature divergence (3.1, 3.3)** — The non-standard function signature and event name mean ERC-1644 tooling would not recognise the function. The `bytes32 legalOrderHash` is arguably more type-safe than raw `bytes _data`.

### Enhancements Beyond Spec (positive, but should be documented)

7. **On-chain OrderBook** — Full limit-order matching engine with escrow not described in the interim architecture.
8. **OracleCommittee** — Multi-oracle 2-of-3 attestation upgrades the spec's single-oracle model.
9. **TokenFactoryV2** — ERC-1967 upgradeable proxies for post-deployment fixes.
10. **SystemHealthCheck** — Cross-contract diagnostics tool.
11. **Travel Rule support** — FATF Rec. 16 data on DvP settlements.
12. **AMLO CDD/STR anchoring** — On-chain AML compliance records.
13. **Tiered minting** — Governance-gated large mints via `TIMELOCK_MINTER_ROLE`.
