# TokenHub Investor Portal — Corporate Actions

## Overview

TokenHub's smart-contract architecture provides on-chain mechanisms that replace traditional corporate-action workflows. ERC20Votes checkpoint snapshots serve as the book-close record, while governance proposals, pause/freeze controls, and compliance modules enforce regulatory requirements throughout the corporate-action lifecycle.

---

## 1. Book Close / Record Date

Traditional book close periods are replaced by **ERC20Votes checkpoint snapshots**.

| Feature | Implementation |
|---------|---------------|
| **Clock Mode** | Timestamp-based (ERC-6372): `clock()` returns `uint48(block.timestamp)` |
| **Snapshot Trigger** | Automatic — checkpoint recorded on every transfer, mint, and burn via `_update()` |
| **Record-Date Query** | `getPastVotes(address, uint256 timestamp)` — voting power at any historical timestamp |
| **Total Supply Query** | `getPastTotalSupply(uint256 timestamp)` — total supply at any historical timestamp |
| **Delegation Requirement** | Voting power is **zero** until explicitly delegated (self-delegation required) |
| **Flash-Loan Resistance** | Tokens acquired after proposal snapshot contribute zero votes |

**Why No Explicit Book Close?**
- The Governor automatically takes a snapshot when a proposal is created (votingDelay starts).
- `getPastVotes()` returns the frozen balance at that snapshot — no transfer halt needed.
- If a hard freeze is required (e.g., SFC directive), `pause()` blocks all transfers globally.

---

## 2. Pause / Unpause (Global Halt)

| Function | Access | Effect |
|----------|--------|--------|
| `pause()` | `DEFAULT_ADMIN_ROLE` | Blocks **all** transfers, mints, and burns (`whenNotPaused` modifier on `_update()`) |
| `unpause()` | `DEFAULT_ADMIN_ROLE` | Resumes normal operations |

**Use Cases:**
- Regulatory halt (SFC emergency directive)
- Emergency circuit breaker during suspected attack
- Maintenance window or corporate-action enforcement period

**DvP Settlement has independent pause:**

| Function | Access | Effect |
|----------|--------|--------|
| `pause()` | `PAUSER_ROLE` | Blocks `createSettlement()` and `executeSettlement()` |
| `unpause()` | `PAUSER_ROLE` | Resumes settlement activity |

> Token transfers and DvP settlement can be paused independently for granular control.

---

## 3. Freeze / Unfreeze (Per-Address)

| Function | Access | Effect |
|----------|--------|--------|
| `setAddressFrozen(address, bool)` | `AGENT_ROLE` | Frozen addresses **cannot send or receive** tokens |

**Enforcement:** Checked in `_update()` for both sender and recipient.

**Override — Forced Transfer (ERC-1644):**
```
forcedTransfer(from, to, amount, legalOrderHash, operatorData)
```
- Access: `AGENT_ROLE` only
- Temporarily unfreezes addresses during the transfer, restores freeze status afterward
- Requires verified recipient; emits `ForcedTransfer` with IPFS CID hash of the court order

**Use Cases:**
- Sanctions / PEP flagging
- Jurisdiction blocking (manual override)
- Investor suspended pending investigation
- Court-ordered asset transfer or liquidator redemption

---

## 4. Compliance Module Checks

The `HKSTPCompliance` module enforces transfer restrictions via the `_update()` hook.

### Transfer Restrictions

| Check | Condition | Set By |
|-------|-----------|--------|
| **Lock-Up Period** | `block.timestamp < lockUpEnd[token][from]` | `setLockUp(token, investor, endTime)` |
| **Per-Investor Cap** | `recipientBalance + amount > concentrationCap[token][to]` | `setConcentrationCap()` |
| **Global Cap** | `recipientBalance + amount > globalConcentrationCap[token]` | `setGlobalConcentrationCap()` |
| **Jurisdiction Whitelist** | Country code not in `allowedJurisdictions` | `setJurisdiction(code, bool)` |
| **EIP-712 Attestation** | One-time oracle-signed attestation (nonce + expiry) | Oracle Committee (2-of-3) |

### Transfer Flow in `_update()`

1. **Burn** (`to == address(0)`) → skip all checks
2. **Both safe-listed** → skip compliance (escrow, treasury, custody paths)
3. **Otherwise:**
   - Verify both parties are KYC-registered and verified
   - Look up country codes from identity registry
   - Call `compliance.checkModules(from, to, amount, toBalance, fromCountry, toCountry)`
   - Revert with reason string if any check fails

### Safe-List Bypass
- `safeListed[address]` set by `AGENT_ROLE` via `setSafeList()`
- Operational addresses (OrderBook escrow, treasury, custody) bypass attestation
- Prevents compliance-oracle bottleneck for internal flows

---

## 5. Governance Proposal Lifecycle

### Parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| Voting Delay | 172,800 s (48 hours) | Time before voting starts after proposal creation |
| Voting Period | 604,800 s (7 days) | Duration voting remains open |
| Proposal Threshold | 1% of total supply | Minimum voting power to create a proposal |
| Quorum | 10% of total supply | Minimum participation for a proposal to succeed |
| Timelock Delay | 48 hours | Mandatory delay between queuing and execution |

### State Machine

| State | Trigger | Duration | Action |
|-------|---------|----------|--------|
| **Pending** | `propose()` called | votingDelay (48h) | Snapshot taken — voting power locked |
| **Active** | votingDelay elapsed | votingPeriod (7d) | `castVote()` — For / Against / Abstain |
| **Succeeded** | For > Against + quorum met | — | Auto-queued to Timelock |
| **Queued** | Governor queues to Timelock | minDelay (48h) | Cannot be executed yet |
| **Executed** | minDelay elapsed + `execute()` | — | Proposal actions execute on-chain |
| **Defeated** | Against ≥ For OR quorum not met | — | Terminal — reason displayed in UI |
| **Cancelled** | Admin calls `cancel()` | — | Terminal |

### Identity-Locked Voting
- `castVote()` reverts if `identityRegistry.isVerified(voter) == false`
- KYC revocation mid-voting period blocks further votes from that address
- Prevents single-oracle KYC manipulation

### Timelock Roles

| Role | Granted To |
|------|-----------|
| `PROPOSER_ROLE` | Governor |
| `EXECUTOR_ROLE` | Governor + `address(0)` (permissionless execution) |
| `CANCELLER_ROLE` | Governor |
| `DEFAULT_ADMIN_ROLE` | Admin + Timelock self-administration |
| `AGENT_ROLE` | Timelock (for minting after governance approval) |
| `TIMELOCK_MINTER_ROLE` | Timelock (for large mints above threshold) |

---

## 6. Token Minting / Burning

### Minting: `mint(address to, uint256 amount)`

**Tiered Access Control:**
```
if (mintThreshold > 0 && amount > mintThreshold):
    require TIMELOCK_MINTER_ROLE   → Governance approval required
else:
    require AGENT_ROLE             → Regular agent can mint
```

**Validation Checks:**
1. Recipient must be KYC-verified (`identityRegistry.isVerified(to)`)
2. Recipient must not be frozen (`!frozen[to]`)
3. Self-dealing prevention: `require(to != msg.sender)`
4. New total supply ≤ `maxSupply` (if set; 0 = unlimited)
5. Post-transfer identity-holder count ≤ `maxShareholders` (Cap. 622)

### Burning: `burn(address from, uint256 amount)`
- Access: `AGENT_ROLE` only
- Can burn frozen addresses (no verification needed)
- Decrements total supply

### Corporate Actions
- **New Issuance / Rights Issue:** Governance proposes mint → timelock delay → execute
- **Share Cancellation:** Agent burns unallocated shares from treasury
- **Redemption:** Forced transfer + burn for investor exit

---

## 7. DvP Settlement (Delivery-versus-Payment)

### Settlement Lifecycle

```
Pending → [Pre-flight checks] → Settled (atomic) OR Failed (with reason)
       → Cancelled (by operator)
```

### Key Functions

| Function | Access | Description |
|----------|--------|-------------|
| `createSettlement()` | `OPERATOR_ROLE` | Create with seller, buyer, tokens, cash, deadline |
| `executeSettlement()` | `OPERATOR_ROLE` | Atomic two-leg settlement |
| `executeBatchSettlement()` | `OPERATOR_ROLE` | Batch execution with optional stop-on-failure |
| `cancelSettlement()` | `OPERATOR_ROLE` | Mark as Cancelled |
| `markFailed()` | Public | Mark expired settlements as Failed |

### Two-Leg Atomicity
- **Leg 1:** Security tokens (seller → buyer) — invokes compliance checks
- **Leg 2:** Cash tokens (buyer → seller)
- If Leg 1 succeeds but Leg 2 fails → entire transaction reverts
- If Leg 1 fails → marked as Failed (no tokens transferred)

### Pre-Flight Checks (Graceful Failure)

| Check | Blocks If |
|-------|-----------|
| Seller balance | `balanceOf(seller) < tokenAmount` |
| Buyer cash balance | `balanceOf(buyer) < cashAmount` |
| Seller verified | Not registered in identity registry |
| Buyer verified | Not registered in identity registry |
| Seller frozen | `frozen[seller] == true` |
| Buyer frozen | `frozen[buyer] == true` |
| Seller lock-up | `lockUpEnd[token][seller] > block.timestamp` |
| Deadline | `block.timestamp > settlementDeadline` |

### FATF Recommendation 16 — Travel Rule
- `setTravelRuleData()` records originator/beneficiary VASP hashes + PII hashes (for transfers ≥ HK$8,000)
- No actual PII stored on-chain — only `keccak256` hashes

---

## 8. OrderBook Trading

### Order Types

| Function | Side | KYC Required | Escrow |
|----------|------|-------------|--------|
| `placeBuyOrder(price, qty)` | Buy | Yes (`isVerified()`) | Buyer locks cash tokens |
| `placeSellOrder(price, qty)` | Sell | Yes (`isVerified()`) | Seller locks security tokens |
| `cancelOrder(orderId)` | — | — | Refund unmatched balance |

### Matching Logic
- Buy orders matched against lowest-ask sellers (price ascending)
- Sell orders matched against highest-bid buyers (price descending)
- Execution price uses maker (resting order) price for price improvement
- Partial fills allowed — remaining quantity stays on the book

### Compliance Force Cancel

| Function | Access | Description |
|----------|--------|-------------|
| `forceCancelOrder(orderId, reason)` | Admin | Force cancel with reason string |
| `cancelOrdersForNonCompliant(investor)` | Admin | Cancel all orders for KYC-revoked investor |

**Escrow Handling:**
- **Cash tokens:** Always refunded (no compliance hook)
- **Security tokens:** If compliance blocks refund, tokens escrowed in OrderBook (`TokensEscrowed` event)
- Escrowed tokens require manual disposition (e.g., forced transfer to treasury)

---

## 9. Dividend / Distribution (Planned)

No dedicated dividend contract is currently deployed. The architecture supports future implementation:

### Planned Flow
1. Governance proposes: "Pay dividend X per token to holders as of timestamp Y"
2. Vote occurs — voting power snapshot taken at proposal creation
3. 48-hour timelock delay
4. Execute calls dividend distribution function
5. Smart contract uses `getPastTotalSupply(Y)` for pro-rata calculation

### ERC20Votes Support
- `getPastTotalSupply(timestamp)` — supply at record date
- `getPastVotes(address, timestamp)` — investor balance at record date
- Per-shareholder dividend = `(balance / totalSupply) × dividendAmount`

### Implementation Paths
1. **Manual distribution:** Timelock calls mint/transfer to distribute cash tokens
2. **Self-serve claiming:** Holders call `claimDividend(timestamp)` with eligible proof
3. **Streaming payments:** Continuous accrual on each transfer

---

## 10. Corporate Actions Timeline

| Phase | Mechanism | Timing | Control |
|-------|-----------|--------|---------|
| **Announcement** | Governance proposal created | Immediate | Shareholders with ≥ 1% ownership |
| **Snapshot** | ERC20Votes checkpoint at proposal block | Automatic | Embedded in Governor protocol |
| **Voting** | `castVote()` — For / Against / Abstain | 48h delay + 7d period | Identity-verified voters only |
| **Queue** | Succeeded proposal queued to Timelock | Automatic | Governor contract |
| **Timelock Delay** | Stakeholders may exit or prepare | 48 hours | Not bypassable |
| **Execution** | `execute()` fires on-chain actions | After timelock | Permissionless (anyone can trigger) |
| **Lock-Up Enforcement** | `lockUpEnd` checked on every transfer | Ambient | Compliance module |
| **Forced Transfer** | Liquidator via `forcedTransfer()` | On-demand | `AGENT_ROLE` admin |

---

## 11. Shareholder Cap (Cap. 622)

| Parameter | Description |
|-----------|-------------|
| `maxShareholders` | Maximum number of unique identity holders (0 = unlimited) |
| `_identityHolders[]` | Set of unique ONCHAINID identities with nonzero balance |

**Enforcement in `_update()`:**
- On transfer/mint to a new identity → add to `_identityHolders`
- If identity's total balance drops to zero → remove from set
- `_identityHolders.length ≤ maxShareholders` enforced on every incoming transfer

---

## Summary

TokenHub's corporate-action architecture is:

- **Governance-transparent** — all material actions require on-chain proposals and shareholder votes
- **Audit-compliant** — ERC20Votes checkpoints provide verifiable record dates
- **Fraud-resistant** — flash-loan protection via snapshot isolation, identity-locked voting
- **Regulator-controllable** — pause/freeze mechanisms allow SFC intervention at any level
- **Atomic** — DvP ensures no incomplete settlement legs during corporate actions
