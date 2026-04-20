# Architecture Alignment Review (v2)

**Comparison of the Repository Implementation vs. the Interim Architecture Specification (`tokenhub_architecture_Interim.md`)**

This document systematically compares every architectural component described in the TokenHub Interim Architecture Specification against the actual smart-contract code and frontend implementation in this repository. It supersedes the original `Alignment_Review.md`, correcting inaccuracies identified in v1 (notably item 3.2, which was a false positive).

**Review Date:** 2026-04-20  
**Contracts Reviewed:** 18 (core + custody + governance + identity + mocks)  
**Frontend Pages Reviewed:** 13  
**Deployment Scripts Reviewed:** 4

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
11. [On-Chain Order Book / Trading Engine](#11-on-chain-order-book--trading-engine)
12. [Oracle Committee & EIP-712 Attestations](#12-oracle-committee--eip-712-attestations)
13. [System Health & Diagnostics](#13-system-health--diagnostics)
14. [Event Log / Genealogy of a Share](#14-event-log--genealogy-of-a-share)
15. [Summary Matrix](#15-summary-matrix)
16. [Key Findings](#16-key-findings)
17. [Corrections from v1](#17-corrections-from-v1)

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
| Multi-Party Quorum | Key generation requires ≥ 3 independent Responsible Officers |
| Geographic distribution | Backup seeds in geographically distinct HK vaults |
| Disruption recovery | 12-hour restoration window |

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `WalletRegistry.sol` | ✅ Aligned | `HOT`, `WARM`, `COLD` enum tiers; enforces 2% hot-cap via `hotCapBps` (default 200 bps); `isHotOverCap()` detection; `checkAndEmitSweep()` for off-chain custody service; per-token AUM tracking via `totalAUM()`, `hotBalance()`, `warmBalance()`, `coldBalance()` |
| `MultiSigWarm.sol` | ✅ Aligned | 2-of-3 (configurable M-of-N) multi-sig; 48-hour proposal expiry (`EXPIRY_PERIOD`); propose → confirm → execute flow; cancellation and confirmation revocation; reason-tagged transfers (`sweep-to-cold`, `replenish-hot`, `withdrawal`, `rebalance`); `ReentrancyGuard` protection |
| Cold wallet transfer block | ✅ Aligned | `canTransferFrom()` rejects `COLD`-tier wallets; designed for air-gapped-only signing |
| `SweepRequired` event | ✅ Aligned | Emitted by `checkAndEmitSweep()` when hot balance exceeds cap; callable by anyone (permissionless event trigger) |
| Frontend (WalletCustody page) | ✅ Aligned | Wallet registration with tier assignment, per-token tier breakdown, hot cap monitoring, multi-sig transaction management, signer management |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 1.1 | Low | **HSM Integration** | The spec mandates FIPS 140-2 Level 3+ HSM. The repo has no HSM-specific code or configuration. This is expected — HSM integration is an infrastructure/ops concern — but no documentation or setup guide exists in the repo. |
| 1.2 | Low | **Air-gapped signing workflow** | The spec describes a detailed QR-code / USB-based air-gap protocol. The repo blocks cold transfers on-chain but provides no tooling (scripts, QR encoder) for the air-gapped signing ceremony. |
| 1.3 | Low | **Disruption recovery** | The 12-hour restoration SLA is a policy commitment with no corresponding implementation or runbook. |
| 1.4 | Low | **Key ceremony protocol** | Multi-party quorum and geographic distribution of backup seeds are operational procedures not represented in code. |
| 1.5 | Informational | **`withdrawETH` single-signer risk** | `MultiSigWarm.withdrawETH()` bypasses the multi-sig confirmation flow — a single signer can drain ETH. This should be noted for security audit. |

---

## 2. Permissioned Ledger & Transfer Compliance

### Interim Architecture Specifies

- Every transfer intercepted by a compliance layer validating identity and eligibility.
- Four ledger state components: Token Contract, Identity Registry, Compliance Contract, Claim Topics Registry.
- Transfer flow: Initiation → Eligibility Check (IdentityRegistry) → Compliance Check → Balance Check → Execution or Revert.
- Rejection of self-custody: only custodian-managed addresses whitelisted.
- Error code `ERC7943NotAllowedUser` for compliance rejections.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPSecurityToken._update()` | ✅ Aligned | Override intercepts every mint/burn/transfer; checks freeze status → identity verification (`isVerified()`) → compliance modules (`checkModules()`) → shareholder cap enforcement. Burns skip all checks. |
| `HKSTPCompliance.sol` | ✅ Aligned | Modular compliance checks: lock-up period, jurisdiction whitelist/blacklist, per-investor concentration cap, global concentration cap. Returns `(bool ok, string reason)` for clear error feedback. |
| `HKSTPIdentityRegistry.sol` | ✅ Aligned | Maps addresses to ONCHAINID; `isVerified()` checks required claim topics; multi-wallet identity linking for Cap. 622 shareholder deduplication. |
| Safe-list mechanism | ✅ Aligned | `setSafeList()` whitelists operational addresses (treasury, escrow, OrderBook, custody wallets). If both parties safe-listed → compliance pipeline bypassed entirely. If only one side → other party still undergoes full checks. |
| Frontend compliance gates | ✅ Aligned | Trading, minting, portfolio transfers, governance proposals, and settlement creation all enforce KYC + freeze pre-checks in the UI before submitting transactions. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 2.1 | Low | **Claim Topics Registry as separate contract** | The spec describes a dedicated "Claim Topics Registry" contract. In the repo, claim topics management is embedded within `HKSTPIdentityRegistry.sol` (`setRequiredClaimTopics()` / `_requiredClaimTopics`). Functionally equivalent — a simplification, not a gap. |
| 2.2 | Low | **Trusted Issuers Registry as separate contract** | The spec implies a standalone "Trusted Issuers Registry". The repo embeds this in `HKSTPIdentityRegistry.sol` (`addTrustedIssuer()` / `removeTrustedIssuer()`). Same functionality, consolidated deployment. |
| 2.3 | Informational | **Error codes** | The spec mentions `ERC7943NotAllowedUser`. The repo uses descriptive `string` error messages rather than numeric error codes. |

---

## 3. forcedTransfer() Protocol

### Interim Architecture Specifies

- ERC-1644 (Controller Token Operation) standard.
- Signature: `forcedTransfer(address _from, address _to, uint256 _amount, bytes _data, bytes _operatorData)`.
- Protected by `onlyAgent` modifier.
- Bypasses `canTransfer()` compliance check.
- **Receiver `_to` must still be verified in IdentityRegistry.**
- Emits `ControllerTransfer` (or `ForcedTransfer`) event.
- `_operatorData` stores IPFS CID pointing to encrypted court order.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPSecurityToken.forcedTransfer()` | ✅ Aligned (with minor signature divergence) | `AGENT_ROLE` protected; `whenNotPaused`; bypasses compliance modules and freeze status via temporary safe-listing; **verifies recipient identity**; requires legal order hash; emits `ForcedTransfer` event |

**Detailed `forcedTransfer()` Logic (lines 460–504):**

1. Validates `from != address(0)`, `to != address(0)`, `to != msg.sender` (self-dealing prevention), `amount > 0`, `legalOrderHash != bytes32(0)`.
2. Checks `balanceOf(from) >= amount`.
3. **✅ Checks `IIdentityRegistry(identityRegistry).isVerified(to)` — recipient MUST be verified.** This was incorrectly flagged as missing in v1.
4. Temporarily safe-lists both `from` and `to` and unfreezes both (court order overrides administrative controls).
5. Calls `_update(from, to, amount)` — the compliance pipeline is bypassed due to both parties being safe-listed.
6. Restores original safe-list and freeze status.
7. Emits `ForcedTransfer(msg.sender, from, to, amount, legalOrderHash, operatorData)`.

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 3.1 | Low | **Function signature differs from ERC-1644** | Spec: `(address, address, uint256, bytes, bytes)`. Repo: `(address, address, uint256, bytes32 legalOrderHash, bytes operatorData)`. The `bytes _data` parameter is replaced by a strongly-typed `bytes32 legalOrderHash`, which is arguably an improvement (enforces non-empty legal reference) but diverges from the canonical ERC-1644 signature. |
| 3.2 | ~~Critical~~ **Resolved** | **Receiver identity verification** | **v1 incorrectly flagged this as missing.** The code at line 479 explicitly calls `isVerified(to)` before executing the transfer. The recipient MUST be a verified identity. This is fully aligned with the spec. |
| 3.3 | Low | **Event name** | The spec says `ControllerTransfer` (ERC-1644 standard). The repo emits `ForcedTransfer`. This breaks compatibility with off-chain tooling expecting the ERC-1644 canonical event name. |
| 3.4 | Informational | **`isControllable()` present** | The contract implements `isControllable() → true`, signaling ERC-1644 support, which is aligned with the spec's intent. |

---

## 4. ERC-3643 (T-REX) Token Standard

### Interim Architecture Specifies

- Core standard is ERC-3643 (T-REX) for compliance-by-design security tokens.
- Five-contract composition: Token Contract + Identity Registry + Compliance Module + Claim Topics Registry + Trusted Issuers Registry.
- Role-based access: Issuer, Agent, Claim Issuer.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPSecurityToken.sol` | ⚠️ T-REX-Inspired | Implements ERC-20, ERC-20 Permit, ERC-20 Votes, Pausable, AccessControl with a compliance-gated transfer pattern. Does **not** implement the canonical T-REX interfaces (`IToken`). |
| Contract architecture | ⚠️ Consolidated | Three contracts (Token + IdentityRegistry + Compliance) instead of the five specified. Claim Topics Registry and Trusted Issuers Registry are folded into `HKSTPIdentityRegistry`. |
| Access control | ✅ Aligned | `DEFAULT_ADMIN_ROLE` (Issuer/Admin), `AGENT_ROLE` (custodian), `TIMELOCK_MINTER_ROLE` (governance enhancement). |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 4.1 | Medium | **Not canonical ERC-3643** | The token does not expose canonical T-REX interfaces (`IToken`, `IIdentityRegistry`, `ICompliance`, `IClaimTopicsRegistry`, `ITrustedIssuersRegistry`). External tooling expecting T-REX ABIs would not interoperate. The core compliance-by-design philosophy is preserved, but formal standard conformance is not achieved. |
| 4.2 | Low | **Consolidated registries** | Claim Topics Registry and Trusted Issuers Registry are embedded in `HKSTPIdentityRegistry`. This simplifies deployment and reduces gas but breaks the T-REX modular composability pattern where registries can be swapped independently. |

---

## 5. Identity Registry & ONCHAINID

### Interim Architecture Specifies

- ONCHAINID (ERC-734/735) for on-chain identity management.
- Claim-based verification: KYC, Accredited Investor, Jurisdiction, Source-of-Funds, PEP/Sanctions.
- Privacy-preserving (no personal data on-chain).
- Multi-wallet identity linking for Cap. 622 shareholder deduplication.
- Shared Identity Registry Storage across all token contracts.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `Identity.sol` | ✅ Aligned | Full ERC-734 key management (MANAGEMENT, ACTION, CLAIM purposes) + ERC-735 claim holder; EIP-1167 clonable; deterministic `claimId = keccak256(abi.encode(issuer, topic))` |
| `IdentityFactory.sol` | ✅ Aligned | EIP-1167 clone deployment; auto-assigns MANAGEMENT key to investor and CLAIM key to agent; self-destructs factory's own management key after setup (secure handoff) |
| `ClaimIssuer.sol` | ✅ Aligned | Trusted issuer with ECDSA signing key; `isClaimValid()` verifies signature against `signingKey`; on-chain revocation via `revokeClaim()`/`unrevokeClaim()` |
| `HKSTPIdentityRegistry.sol` | ✅ Aligned (enhanced) | Dual-mode `isVerified()`: ONCHAINID claims (ERC-735 with signature validation, expiry, revocation) or boolean claims (fallback). 6 claim topics (spec has 5 + repo adds FPS Name-Match). Multi-wallet identity linking with O(1) removal. 4 roles: `DEFAULT_ADMIN_ROLE`, `AGENT_ROLE`, `COMPLIANCE_OFFICER_ROLE`, `MLRO_ROLE`. |
| Privacy | ✅ Aligned | No PII on-chain. Claims store only `abi.encode(identity, topic, expiry)` + ECDSA signature. |
| Shareholder deduplication | ✅ Aligned | `aggregateBalanceByIdentity()` sums balances across all linked wallets; `_identityHolders` tracks unique ONCHAINID addresses; Cap. 622 limit enforced via `maxShareholders`. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 5.1 | Informational | **Claim Topic 6 (FPS Name-Match)** | The spec lists 5 claim topics. The repo adds topic 6: "FPS Name-Match Verified" for fiat deposit compliance. This is an undocumented enhancement. |
| 5.2 | Informational | **CDD / STR on-chain anchoring** | The repo includes `anchorCDDRecord()` (AMLO s.22, 5-year CDD retention) and `reportSuspiciousActivity()` (AMLO s.25A STR filing). Not described in the interim architecture — these are regulatory compliance enhancements. |
| 5.3 | Low | **`removeTrustedIssuer()` topic cleanup** | The cleanup loop in `removeTrustedIssuer()` iterates topics 1–5 but does not clean topic 6 (FPS Name-Match). A minor bug that leaves stale topic-6 mappings if an issuer was trusted for that topic. |

---

## 6. Gas Optimisation Strategies

### Interim Architecture Specifies

| Strategy | Specification |
|---|---|
| EIP-1167 Minimal Proxy | ~90% gas savings for token deployment; each startup gets independent address/storage but shares logic bytecode |
| Shared Identity Registry Storage | Central `IdentityRegistryStorage` reduces redundant KYC writes |
| EIP-712 Off-chain Signatures | Compliance oracle issues off-chain attestation; contract uses `ecrecover` (~3,000 gas) |

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `TokenFactory.sol` (EIP-1167) | ✅ Aligned | Uses `Clones.clone()` from OpenZeppelin to deploy `HKSTPSecurityToken` minimal proxies. Each clone ~45 bytes of runtime bytecode. ~90% gas savings per deployment. |
| `IdentityFactory.sol` (EIP-1167) | ✅ Aligned | Uses `Clones.clone()` for `Identity` contracts (ONCHAINID). Same ~90% savings. |
| `TokenFactoryV2.sol` (ERC-1967) | ✅ Enhancement | Adds upgradeable proxy support. `UPGRADER_ROLE` can batch-upgrade all deployed proxies atomically via `upgradeImplementation()`. Not in spec but addresses the immutability limitation of EIP-1167 clones. |
| Shared Identity Registry | ✅ Aligned | All tokens share the same `HKSTPIdentityRegistry` instance (via `TokenFactory.setInfrastructure()`). Investor verified once, can trade any token. |
| EIP-712 Attestation | ✅ Aligned | `HKSTPCompliance.sol` implements EIP-712 typed-data signing for off-chain compliance attestations. `ATTESTATION_TYPEHASH` with `(from, to, amount, expiry, nonce)`. Single-use via `usedAttestations` mapping. |
| `OracleCommittee.sol` | ✅ Enhancement | Upgrades single-oracle to 2-of-3 multi-signature attestation via `consumeMultiAttestation()`. Uses the same EIP-712 domain for signature compatibility. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 6.1 | Low | **No standalone IdentityRegistryStorage** | The spec describes a physically separated "Identity Storage Layer" from the "Identity Registry". The repo uses a single `HKSTPIdentityRegistry` that handles both registry logic and storage. The shared-data benefit is still achieved (all tokens point to one registry instance), but the two-contract separation described in the spec is not followed. |
| 6.2 | Informational | **OrderBookFactory uses `new` not clones** | `OrderBookFactory.createOrderBook()` deploys full `OrderBook` contracts via `new OrderBook(...)` rather than EIP-1167 clones. The gas optimisation strategy is not applied to order book deployments. |

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
| Automated execution | TimelockController handles execution |

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPGovernor.sol` | ✅ Aligned | OpenZeppelin Governor with `GovernorSettings`, `GovernorCountingSimple`, `GovernorVotes`, `GovernorVotesQuorumFraction`, `GovernorTimelockControl`. Identity-locked `_castVote()` checks `identityRegistry.isVerified(voter)` — KYC-expired voters are blocked and `VoteBlockedKYC` event is emitted. Flash-loan resistant via ERC20Votes checkpoints. |
| `HKSTPTimelock.sol` | ✅ Aligned | Standard OZ `TimelockController`. |
| `GovernorFactory.sol` | ✅ Enhancement | Per-token governance registry. Tokens can each have their own Governor + Timelock suite. |
| Deployment parameters | ✅ Aligned | `deploy-and-update-frontend.js` hardcodes production values: `TIMELOCK_MIN_DELAY = 172800` (48h), `VOTING_DELAY = 172800` (48h), `VOTING_PERIOD = 604800` (7d), `QUORUM_PCT = 10`, `PROPOSAL_THRESHOLD = 10000e18` (1%). |
| Signaling proposals | ✅ Enhancement | Frontend supports two proposal types: **Executable** (encodes on-chain calldata) and **Signaling** (empty calldata, records sentiment only). Signaling proposals are open to all token holders; executable are Admin/Agent only. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 7.1 | Informational | **No separate production deployment profile** | While governance parameters match the spec, there is no separate production vs. development configuration toggle. The same production-grade values are used on devnet, which makes testing slow (48h delays). The frontend includes devnet fast-forward helpers to work around this. |
| 7.2 | Informational | **Signaling proposals not in spec** | The spec only describes executable governance actions. Signaling proposals (non-binding votes) are an enhancement added by the repo. |

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
| `mint()` | ✅ Aligned (enhanced) | Tiered access: ≤ `mintThreshold` requires `AGENT_ROLE`; > `mintThreshold` requires `TIMELOCK_MINTER_ROLE` (governance). Pre-checks: `to != msg.sender` (self-dealing), `maxSupply` enforcement, `isVerified(to)`, `!frozen[to]`. Enters `_update()` which runs the full compliance pipeline on the recipient. |
| `burn()` | ✅ Aligned | `AGENT_ROLE` required. Burns skip all compliance checks in `_update()` (correct — no need to verify a burn target's KYC). |
| Atomic DvP mint | ✅ Aligned | `DvPSettlement.sol` handles atomic dual-leg transfers (not minting per se, but the settlement of security tokens against cash tokens). |
| Frontend (TokenMinting page) | ✅ Aligned | Multi-token selector, KYC pre-check on recipient, supply safeguard configuration (maxSupply, mintThreshold), tiered minting display. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 8.1 | Medium | **No dedicated recovery function** | The spec describes a `recoveryAddress()` map and an atomic recovery flow (burn-from-lost + mint-to-new in one transaction). The repo has no `recoverTokens()` function. Recovery requires two separate Agent transactions: `burn(lostWallet, amount)` + `mint(newWallet, amount)`. A `RecoverySuccess` event is declared but never emitted — it appears to be a placeholder for future implementation. The two-step approach introduces risk of partial execution. |
| 8.2 | Informational | **Tiered minting not in spec** | The `mintThreshold` + `TIMELOCK_MINTER_ROLE` governance gate for large mints is an enhancement not described in the spec. It strengthens supply-side controls beyond what the architecture requires. |

---

## 9. Atomic DvP Settlement

### Interim Architecture Specifies

- Dual-token custody: Asset Leg (security token) + Payment Leg (tokenized cash).
- Atomic settlement: both legs succeed or entire transaction reverts.
- T+0 settlement cycle.
- Pre-trade compliance verification.
- Aligned with HKMA "Project Ensemble" vision.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `DvPSettlement.sol` | ✅ Aligned | `createSettlement()` + `executeSettlement()` with atomic dual-leg transfer via `transferFrom()`. Pre-flight compliance checks (KYC, freeze, lock-up, balance) with graceful failure (status → `Failed` with descriptive reason, not revert). State set to `Settled` before external calls (CEI pattern). |
| Pre-flight checks | ✅ Aligned | 7 checks: seller balance, buyer balance, seller verified, buyer verified, seller not frozen, buyer not frozen, seller not locked-up. Failures emit `SettlementFailed(id, matchId, reason)`. |
| Batch settlement | ✅ Enhancement | `executeBatchSettlement()` processes up to 50 settlements per call with `try/catch` for individual failure isolation. |
| Travel Rule | ✅ Enhancement | `setTravelRuleData()` stores FATF Rec. 16 / HKMA data (VASP identifiers, originator/beneficiary hashes). Privacy-preserving — only keccak256 hashes stored on-chain. |
| Frontend (Settlement page) | ✅ Aligned | Multi-token settlement creation, execute with allowance pre-checks and auto-approval, batch execution, expiry tracking, soft-failure event detection. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 9.1 | Medium | **No real tokenized-deposit integration** | The spec references Project Ensemble and tokenized deposits from commercial banks (wCBDC). The repo uses `MockCashToken` — a minimal ERC-20 with no compliance checks, no freeze mechanism, no transfer restrictions, and privileged `mint()`/`burn()` by a single `owner`. Appropriate for testing but no integration stub or interface for real tokenized deposits exists. |
| 9.2 | Low | **Creator cannot execute own settlement** | The contract enforces `msg.sender != s.createdBy` on execution, requiring a different operator to execute than the one who created the settlement. This dual-control pattern is not specified in the architecture but is a reasonable security enhancement. |

---

## 10. Deposit / Withdrawal Workflow (FPS)

### Interim Architecture Specifies

- FPS-based deposit: investor pays via FPS QR code → payment notification → mint digital HKD.
- Closed-loop withdrawal: burn digital HKD → FPS payout to verified bank account.
- AML compliance check before withdrawal.
- Future integration with Project Ensemble (tokenized deposits from commercial banks).

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| FPS Integration | ❌ **Not Implemented** | No FPS API integration, webhook handler, QR code generator, or off-chain deposit/withdrawal service exists in the repository. |
| Cash token mint/burn | ⚠️ Partial | `MockCashToken` has `mint()` / `burn()` gated by `onlyOwner`. No KYC checks, no compliance hooks, no freeze mechanism. Suitable for testing only. |
| Claim Topic 6 (FPS Name-Match) | ✅ Preparatory | The identity registry includes an FPS Name-Match claim topic (topic 6), indicating the design anticipates FPS integration. The KYC management frontend supports issuing this claim. |
| Frontend references | ⚠️ Minimal | WalletCustody page has a placeholder label "Hot-FPS-1" suggesting FPS-integrated wallets are anticipated in the tier structure. No functional FPS UI exists. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 10.1 | **High** | **No FPS integration** | The deposit/withdrawal workflow described in the spec is entirely absent from the repo. This is the single **largest gap** between the architecture document and the codebase. The full fiat on/off-ramp (FPS QR codes, payment webhooks, closed-loop withdrawals, AML pre-checks) has no corresponding implementation. |
| 10.2 | Medium | **No withdrawal AML checks** | The spec describes AML compliance checks before withdrawal. `MockCashToken.burn()` has no compliance hooks — any address can have tokens burned by the owner without AML verification. |
| 10.3 | Low | **No Project Ensemble stub** | The architecture references future integration with HKMA tokenized deposits and wCBDC. No interface or adapter pattern exists for plugging in real tokenized deposit providers. |

---

## 11. On-Chain Order Book / Trading Engine

### Interim Architecture Specifies

The interim architecture does **not** describe an on-chain order book or matching engine. Trading is assumed to occur via the DvP settlement mechanism with off-chain matching.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `OrderBook.sol` | ✅ Enhancement | Full on-chain limit-order book. Buy/sell orders with escrow (cash escrowed for buys, security tokens escrowed for sells). Auto-matching engine: incoming orders matched against resting orders at maker's price with price improvement refunds. Partial fills supported. KYC gate: `isVerified(msg.sender)` on every order placement. |
| `OrderBookFactory.sol` | ✅ Enhancement | One `OrderBook` per security token, shared cash token (`THKD`). Market activation/deactivation. Prevents duplicate markets. |
| Admin force-cancel | ✅ Enhancement | `forceCancelOrder()` with reason string; `cancelOrdersForNonCompliant()` batch-cancels all open orders for de-verified investors. |
| Token escrow safety | ✅ Enhancement | Security token refund on cancel uses `try/catch` — if compliance blocks the refund (KYC revoked), tokens remain escrowed with `TokensEscrowed` event, requiring admin intervention via `forcedTransfer()`. |
| Frontend (Trading page) | ✅ Enhancement | Multi-market support, real-time order book display (bids/asks/spread), order placement with auto-approval, trade history, user order management, admin force-cancel. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 11.1 | Informational | **Undocumented scope expansion** | The on-chain OrderBook and OrderBookFactory are significant components not mentioned in the interim architecture. This is a valuable enhancement enabling T+0 trading without off-chain matching infrastructure, but represents scope expansion beyond the documented architecture. |
| 11.2 | Low | **OrderBook deployed via `new` not clones** | Unlike security tokens (EIP-1167 clones), each OrderBook is a full contract deployment via `new OrderBook(...)`. The gas optimisation strategy from Section 6 is not applied here. |

---

## 12. Oracle Committee & EIP-712 Attestations

### Interim Architecture Specifies

- EIP-712 off-chain compliance signatures from a "Compliance Service".
- Single-oracle attestation model.
- `ecrecover` (~3,000 gas) for on-chain verification.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `HKSTPCompliance.sol` | ✅ Aligned | EIP-712 structured data signing with `ATTESTATION_TYPEHASH`. Single-oracle `verifyAttestation()` / `consumeAttestation()` with replay protection (`usedAttestations` mapping). `TOKEN_ROLE` gating on `consumeAttestation()`. |
| `OracleCommittee.sol` | ✅ Enhancement | Extends to N-of-M (default 2-of-3, max 5) multi-oracle attestation. Same EIP-712 domain (`"HKSTPCompliance", "1"`) for signature compatibility with single-oracle mode. On-chain deduplication prevents double-signing. `verifyMultiAttestation()` / `consumeMultiAttestation()`. |
| Frontend (OracleCommittee page) | ✅ Enhancement | Member management, threshold configuration, security level indicators. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 12.1 | Informational | **Multi-oracle undocumented** | The multi-oracle committee is a significant security enhancement over the spec's single-oracle model but is not described in the interim architecture. |
| 12.2 | Informational | **`consumeMultiAttestation` has no role gate** | The function is externally callable without role restrictions. Access control is expected from the caller contract (the token or compliance module), but if called directly by anyone, attestations could be consumed (burned) maliciously. |

---

## 13. System Health & Diagnostics

### Interim Architecture Specifies

Not described.

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| `SystemHealthCheck.sol` | ✅ Enhancement | View-only single-RPC-call diagnostics across all 12 contract addresses. 20 checks covering: wiring (Token↔Registry↔Compliance↔Factory), admin roles (6 contracts), operational (TOKEN_ROLE, pause status, supply), deployment (MultiSig, Governor, Timelock, IdentityFactory, PAUSER_ROLE). All checks use `try/catch` — never reverts. |
| Frontend (Dashboard) | ✅ Enhancement | Calls `fullHealthCheck()` to display contract health status with pass/fail per check. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 13.1 | Informational | **Undocumented** | Practical DevOps tool not mentioned in the interim architecture. |

---

## 14. Event Log / Genealogy of a Share

### Interim Architecture Specifies

The spec describes a detailed event-log system forming a "Genealogy of a Share" for audit and forensic analysis:

| Event Name | Purpose |
|---|---|
| `IdentityLinked` | Wallet-to-identity mapping |
| `TransferApproved` | Compliance authorization history |
| `ForcedAction` | Legal basis for administrative intervention |
| `ComplianceRuleUpdated` | Governance rule change monitoring |

### Repository Implementation

| Component | Status | Details |
|---|---|---|
| Identity events | ✅ Aligned | `IdentityRegistered`, `IdentityRemoved`, `IdentityUpdated`, `WalletLinked`, `WalletUnlinked`, `ClaimSet`, `ClaimIssued` — comprehensive identity lifecycle tracking. |
| Transfer events | ✅ Aligned | Standard ERC-20 `Transfer` events; `TokensMinted`, `TokensBurned` for supply changes; `AttestationConsumed` for compliance authorization. |
| Forced action events | ✅ Aligned | `ForcedTransfer` event includes controller address, from, to, amount, legal order hash, and operator data. |
| Compliance events | ✅ Aligned | `ConcentrationCapSet`, `GlobalConcentrationCapSet`, `JurisdictionSet`, `LockUpSet`, `RequiredClaimTopicsSet`, `TrustedIssuerAdded`, `TrustedIssuerRemoved`. |
| Additional audit events | ✅ Enhancement | `SuspiciousActivityReported` (STR), `CDDRecordAnchored` (CDD retention), `SweepRequired`, `SweepExecuted`, `OrderPlaced`, `TradeExecuted`, `SettlementCreated`, `SettlementExecuted`, `SettlementFailed`, governance lifecycle events. |

### Misalignments

| # | Severity | Area | Detail |
|---|---|---|---|
| 14.1 | Informational | **Event names differ** | The spec's canonical event names (`IdentityLinked`, `TransferApproved`, `ForcedAction`, `ComplianceRuleUpdated`) differ from the actual implementations, but the same data is captured with equivalent or richer parameter sets. |

---

## 15. Summary Matrix

| # | Architecture Domain | Interim Spec | Repo Status | Verdict | Change from v1 |
|---|---|---|---|---|---|
| 1 | Hot/Warm/Cold Custody (98/2 rule) | ✅ Specified | ✅ Implemented | **Aligned** (HSM/air-gap tooling absent as expected) | No change |
| 2 | Permissioned Transfer Compliance | ✅ Specified | ✅ Implemented | **Aligned** (registries consolidated) | No change |
| 3 | `forcedTransfer()` (ERC-1644) | ✅ Specified | ✅ Implemented | **Aligned** — signature differs (typed hash improvement); receiver IS verified; event name differs | **Upgraded** from "Partially Aligned" — v1 item 3.2 was incorrect |
| 4 | ERC-3643 (T-REX) Token Standard | ✅ Specified | ⚠️ T-REX-Inspired | **Partially Aligned** — compliant in spirit but not canonical interfaces | No change |
| 5 | ONCHAINID (ERC-734/735) Identity | ✅ Specified | ✅ Implemented | **Aligned** (+ CDD/STR enhancements) | No change |
| 6 | Gas Optimisation (EIP-1167, shared registry, EIP-712) | ✅ Specified | ✅ Implemented | **Aligned** (+ ERC-1967 upgrade path) | No change |
| 7 | Governance Voting (Governor + Timelock) | ✅ Specified | ✅ Implemented | **Aligned** (production params confirmed in deploy script) | **Upgraded** — v1 flagged test defaults; deploy script uses production values |
| 8 | Minting / Burning / Recovery | ✅ Specified | ⚠️ Implemented | **Partially Aligned** — no dedicated recovery function or `recoveryAddress()` map | No change |
| 9 | Atomic DvP Settlement | ✅ Specified | ✅ Implemented | **Aligned** (+ batch settlement, travel rule) | No change |
| 10 | FPS Deposit / Withdrawal Workflow | ✅ Specified | ❌ Missing | **Not Implemented** | No change |
| 11 | On-Chain Order Book | ❌ Not in spec | ✅ Implemented | **Enhancement** beyond spec | No change |
| 12 | Oracle Committee (multi-sig attestation) | ❌ Not in spec | ✅ Implemented | **Enhancement** beyond spec | No change |
| 13 | System Health Check | ❌ Not in spec | ✅ Implemented | **Enhancement** beyond spec | No change |
| 14 | Event Log / Genealogy of a Share | ✅ Specified | ✅ Implemented | **Aligned** (richer event set than spec) | **New section in v2** |

---

## 16. Key Findings

### Critical Misalignments (require attention)

1. **FPS Integration Missing (10.1)** — The entire fiat deposit/withdrawal workflow described in the spec (FPS QR codes, payment webhooks, digital HKD minting, closed-loop withdrawals, AML pre-checks) has no implementation. This is the single largest gap between the architecture and the codebase. The `MockCashToken` serves testing needs but has no compliance checks.

### Moderate Misalignments (acceptable with documentation)

2. **Not canonical ERC-3643 (4.1)** — The implementation is T-REX-inspired but custom. External T-REX tooling will not interoperate. If canonical ERC-3643 compliance is a regulatory or ecosystem requirement, this needs remediation. However, the compliance-by-design philosophy (identity-gated transfers, modular compliance, claim-based verification) is fully preserved.

3. **No dedicated token recovery function (8.1)** — The spec describes a `recoveryAddress()` map and atomic recovery flow. The repo requires two separate Agent transactions (`burn` + `mint`), introducing partial-execution risk. A `RecoverySuccess` event exists but is never emitted.

### Low-Severity Misalignments (cosmetic / interoperability)

4. **`forcedTransfer()` signature divergence (3.1)** — `bytes32 legalOrderHash` replaces `bytes _data`. This is strongly-typed and arguably better, but breaks ERC-1644 canonical form.

5. **Event naming (3.3, 14.1)** — `ForcedTransfer` vs. `ControllerTransfer` and other event name differences. Affects ERC-1644 tooling interoperability.

6. **Consolidated registries (2.1, 2.2, 6.1)** — Three contracts instead of five. Functionally equivalent but not T-REX modular.

7. **`removeTrustedIssuer()` topic-6 gap (5.3)** — Cleanup loop iterates topics 1–5, missing topic 6 (FPS Name-Match). Minor storage leak.

### Enhancements Beyond Spec (positive — should be documented in updated architecture)

| # | Enhancement | Contracts | Impact |
|---|---|---|---|
| E1 | On-chain OrderBook + Factory | `OrderBook.sol`, `OrderBookFactory.sol` | Full limit-order matching with escrow; eliminates need for off-chain matching |
| E2 | OracleCommittee (multi-sig attestation) | `OracleCommittee.sol` | 2-of-3 multi-oracle upgrades single-oracle; prevents single point of compromise |
| E3 | TokenFactoryV2 (upgradeable proxies) | `TokenFactoryV2.sol` | ERC-1967 proxies allow post-deployment vulnerability fixes; batch upgrade via `UPGRADER_ROLE` |
| E4 | SystemHealthCheck | `SystemHealthCheck.sol` | Single-call cross-contract diagnostics (20 checks) |
| E5 | Travel Rule (FATF Rec. 16) | `DvPSettlement.sol` | On-chain VASP identifiers and originator/beneficiary hashes |
| E6 | AMLO CDD/STR anchoring | `HKSTPIdentityRegistry.sol` | On-chain AML compliance records with retention tracking (s.22) and STR filing (s.25A) |
| E7 | Tiered minting (governance gate) | `HKSTPSecurityToken.sol` | `mintThreshold` + `TIMELOCK_MINTER_ROLE` for large mints |
| E8 | Signaling proposals | `HKSTPGovernor.sol` + Frontend | Non-binding governance votes for all token holders |
| E9 | Compliance Force Cancel | Frontend (KYC page) | Cross-system scan to cancel all outstanding items for non-compliant investors |
| E10 | Batch DvP settlement | `DvPSettlement.sol` | Up to 50 settlements per call with individual failure isolation |
| E11 | Per-token governance | `GovernorFactory.sol` | Each security token can have its own Governor + Timelock governance suite |

---

## 17. Corrections from v1

| v1 Item | v1 Finding | v2 Correction | Reason |
|---|---|---|---|
| **3.2** | "Receiver identity verification — The actual `forcedTransfer()` bypasses all compliance checks including identity verification, meaning tokens could be forced to an unverified address. This is a functional misalignment." | **Resolved / False Positive.** `forcedTransfer()` explicitly calls `IIdentityRegistry(identityRegistry).isVerified(to)` at line 479 before executing the transfer. The receiver MUST be a verified identity. Only compliance modules (concentration caps, jurisdiction, lock-up) and freeze status are bypassed via temporary safe-listing — the identity check is performed separately. | The v1 review appears to have conflated "bypasses compliance checks" with "bypasses identity verification". The code performs the identity check explicitly before the safe-list/unfreeze bypass. |
| **7.1** | "The repo's `HKSTPTimelock` defaults to 1 block for testing." | **Clarified.** The `deploy-and-update-frontend.js` script (the authoritative deployment script) hardcodes `TIMELOCK_MIN_DELAY = 172800` (48 hours), which matches the spec. The 1-block comment in the contract NatDoc refers to the constructor parameter's test-friendly default, but the actual deployment uses production values. | Deploy script review confirmed production parameters. |
| **7.2** | "Governor parameters… hardcodes test-friendly values." | **Corrected.** The deploy script uses production values: `VOTING_DELAY = 172800` (48h), `VOTING_PERIOD = 604800` (7d), `QUORUM_PCT = 10`, `PROPOSAL_THRESHOLD = 10000e18`. These match the spec exactly. | Deploy script review confirmed. |
