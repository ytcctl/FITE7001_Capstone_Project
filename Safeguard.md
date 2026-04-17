# Supply Safeguard — Tiered Minting & Governance Approval

This document describes the token supply safeguard mechanism built into the
HKSTP Security Token platform, including the tiered minting roles and the
full Governor → Timelock governance workflow for large mints.

---

## 1. Overview

`HKSTPSecurityToken.mint()` enforces **tiered access control** to prevent
unauthorised or excessive token issuance:

| Mint Size | Required Role | Who Holds It | Approval |
|---|---|---|---|
| `amount ≤ mintThreshold` | `AGENT_ROLE` | Admin / Agent | Direct — single transaction |
| `amount > mintThreshold` | `TIMELOCK_MINTER_ROLE` | Timelock contract | Governance — requires proposal + vote |

When `mintThreshold` is set to **0**, the threshold is disabled and all mints
go through `AGENT_ROLE` only.

### Additional Checks on Every Mint

Regardless of tier, every mint also requires:

- **Self-dealing prevention** — caller cannot mint to themselves.
- **Supply cap** — `totalSupply() + amount ≤ maxSupply` (if `maxSupply > 0`).
- **KYC verification** — recipient must pass `identityRegistry.isVerified()`.
- **Not frozen** — recipient must not be frozen.
- **Compliance module enforcement** — the mint passes through the full
  `HKSTPCompliance.checkModules()` pipeline (same as transfers). This means
  **per-token concentration caps** (both per-investor and global),
  **jurisdiction restrictions**, and **lock-up periods** are all enforced on
  the recipient during minting. For example, minting 200 tokens to an
  investor with a 100-token per-investor cap will revert.

> **Implementation detail**: In `_update()`, only burns (`to == address(0)`)
> skip compliance checks. Mints (`from == address(0)`) enter the compliance
> pipeline with the sender treated as safe-listed (skipping sender
> verification) while the recipient undergoes the full `checkModules()`
> validation including concentration caps, jurisdiction, and lock-up checks.

---

## 2. Configuring the Safeguard (Admin)

Both parameters are set via the Token Minting page (Admin only) or directly
on-chain. Only `DEFAULT_ADMIN_ROLE` can change them.

### Set Max Supply (Hard Cap)

```
securityToken.setMaxSupply(cap)
```

- `cap = 0` → unlimited supply
- `cap` cannot be set below the current `totalSupply()`
- **Frontend**: Token Minting → Supply Safeguard Configuration → Max Supply

### Set Mint Threshold (Governance Gate)

```
securityToken.setMintThreshold(threshold)
```

- `threshold = 0` → all mints use `AGENT_ROLE` only (governance gate disabled)
- `threshold > 0` → any single mint exceeding this amount requires `TIMELOCK_MINTER_ROLE`
- **Frontend**: Token Minting → Supply Safeguard Configuration → Mint Threshold

---

## 3. Small Mint Procedure (≤ Threshold)

**Who**: Admin or Agent (wallet with `AGENT_ROLE`)

1. Navigate to **Token Minting** page.
2. Select the target token from the dropdown.
3. Enter the recipient address and amount (must be ≤ `mintThreshold`).
4. Click **Mint** and confirm the transaction.
5. The mint executes immediately in a single transaction.

---

## 4. Large Mint Procedure (> Threshold) — Governor → Timelock

**Who**: Requires coordination between token holders and the governance system.

The `TIMELOCK_MINTER_ROLE` is held by the **Timelock contract**, which can
only execute actions that have been approved through the **Governor** voting
process. No single person can trigger a large mint.

### Deployment Parameters (Production)

| Parameter | Value | Description |
|---|---|---|
| Voting Delay | 14,400 blocks (~2 days) | Wait before voting opens |
| Voting Period | 50,400 blocks (~7 days) | Duration voting is open |
| Proposal Threshold | 10,000 tokens (1% of 1M) | Min voting power to create a proposal |
| Quorum | 10% of total supply | Min participation for valid vote |
| Timelock Delay | 172,800 seconds (48 hours) | Wait before execution after approval |

> **Devnet / Testing**: All delays are reduced to 1 block for rapid testing.

### Step-by-Step Procedure

#### Step 1 — Delegate Voting Power

Every token holder who wants to participate in governance must first
**delegate** their voting power. This activates the ERC20Votes checkpoint
system so their balance is recorded as voting weight.

- **Frontend**: Navigate to **Governance** page → **Voting Power** section →
  click **Self-Delegate** (or enter another address to delegate to).
- **Contract call**: `securityToken.delegate(myAddress)`

> Delegation only needs to be done **once**. It remains active until changed.
> Tokens acquired *after* a proposal is created carry zero voting power for
> that proposal (flash-loan resistant).

#### Step 2 — Create a Proposal

Any KYC-verified holder with voting power ≥ `proposalThreshold` (10,000
tokens) submits a governance proposal.

The **Governance** page supports two proposal types:

| Type | Purpose | On-chain Effect |
|---|---|---|
| **Signaling** | Advisory vote (e.g. policy change) | None — description only |
| **Executable Action** | Token operation via Timelock | Encodes calldata, executed on approval |

**Supported Executable Actions:**

| Action | Function | Parameters |
|---|---|---|
| Mint tokens | `mint(address, uint256)` | Recipient address, amount |
| Burn tokens | `burn(address, uint256)` | Target address, amount |
| Set max supply cap | `setMaxSupply(uint256)` | New cap |
| Set mint threshold | `setMintThreshold(uint256)` | New threshold |
| Pause token transfers | `pause()` | — |
| Unpause token transfers | `unpause()` | — |

- **Frontend**: Navigate to **Governance** page → **Create Proposal** →
  select **Executable Action** → choose an action from the dropdown →
  fill in the required parameters and a description → click **Propose**.
  The target contract is automatically set to the HKSTPSecurityToken address.

- **Contract call** (example — large mint):
  ```solidity
  bytes memory mintCalldata = abi.encodeWithSignature(
      "mint(address,uint256)", recipientAddress, mintAmount
  );
  governor.propose(
      [securityTokenAddress],  // targets
      [0],                     // values (no ETH sent)
      [mintCalldata],          // calldatas
      "Proposal: mint 500,000 HKSAT to investor 0x1234..."
  );
  ```

#### Step 3 — Wait: Voting Delay

After proposal creation, there is a mandatory **voting delay** before voting
opens. This gives all token holders time to review the proposal.

- **Production**: ~2 days (14,400 blocks at 12 s/block)
- **Devnet**: 1 block

#### Step 4 — Cast Votes

During the **voting period**, KYC-verified token holders vote on the proposal.

- **Frontend**: Navigate to **Governance** page → find the active proposal →
  click **For**, **Against**, or **Abstain**.
- **Contract call**: `governor.castVote(proposalId, 1)` (1 = For, 0 = Against,
  2 = Abstain)

> **Identity-Locked Voting**: The Governor checks `isVerified()` on every
> vote. If a voter's KYC has expired or been revoked, their vote is rejected
> — even if they hold delegated voting power.

For the proposal to pass:
- **Quorum**: ≥ 10% of total supply must participate.
- **Majority**: More For votes than Against votes.

#### Step 5 — Queue in Timelock

Once the voting period ends and the proposal has passed, it must be
**queued** into the Timelock contract. This starts the execution delay.

- **Frontend**: Navigate to **Governance** page → find the succeeded proposal
  → click **Queue**.
- **Contract call**:
  ```solidity
  governor.queue(targets, values, calldatas, descriptionHash)
  ```

#### Step 6 — Wait: Timelock Delay

The Timelock enforces a mandatory waiting period before queued operations
can be executed. This gives stakeholders time to react — for example, to
exit their positions if they disagree with the outcome.

- **Production**: 48 hours (172,800 seconds)
- **Devnet**: 1 block

#### Step 7 — Execute

After the timelock delay has elapsed, **anyone** can execute the queued
operation.

- **Frontend**: Navigate to **Governance** page → find the queued proposal
  → click **Execute**.
- **Contract call**:
  ```solidity
  governor.execute(targets, values, calldatas, descriptionHash)
  ```

The Governor instructs the Timelock contract to call
`securityToken.mint(recipient, amount)`. Because the Timelock holds
`TIMELOCK_MINTER_ROLE`, the mint is authorised and succeeds.

---

## 5. Governance Flow Diagram

```
Token Holder
    │
    ├─[1] securityToken.delegate(self)
    │         └─ Activates ERC20Votes checkpoint
    │
    ├─[2] governor.propose(mint calldata, description)
    │         └─ Proposal created (ID assigned)
    │
    ├─[3] ── Voting Delay (~2 days) ──►
    │
    ├─[4] governor.castVote(proposalId, support)  × N voters
    │         └─ KYC-gated: isVerified() checked per vote
    │
    ├─[5] governor.queue(...)
    │         └─ Proposal queued in Timelock
    │
    ├─[6] ── Timelock Delay (48 hours) ──►
    │
    └─[7] governor.execute(...)
              └─ Timelock → securityToken.mint(recipient, amount)
                                ✓ TIMELOCK_MINTER_ROLE satisfied
```

**Total time (production)**: approximately 11 days end-to-end
(2-day delay + 7-day vote + 48-hour timelock).

---

## 6. Role Summary

| Role | Held By | Scope |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Deployer / Admin + Timelock | Configure maxSupply, mintThreshold, grant roles |
| `AGENT_ROLE` | Admin + Agent | Mint (≤ threshold), burn, freeze, safe-list |
| `TIMELOCK_MINTER_ROLE` | Timelock contract | Mint (> threshold) — only via governance |
| `PROPOSER_ROLE` | Governor (on Timelock) | Queue approved proposals |
| `EXECUTOR_ROLE` | Governor (on Timelock) | Execute ready proposals |
| `CANCELLER_ROLE` | Governor (on Timelock) | Cancel pending proposals |

---

## 7. Security Considerations

- **Flash-loan resistance**: Voting power is snapshotted at proposal creation
  block. Tokens acquired after a proposal is created have zero voting weight.
- **KYC enforcement**: Every vote is checked against the Identity Registry.
  Revoked or expired KYC blocks voting.
- **Self-dealing prevention**: The `mint()` function rejects calls where
  `to == msg.sender`.
- **Supply cap**: `maxSupply` provides an absolute ceiling that cannot be
  exceeded even through governance.
- **Timelock transparency**: The 48-hour execution delay allows stakeholders
  to observe and react to approved proposals before they take effect.

---

## 8. DvP Settlement Pre-Flight Checks

`DvPSettlement.executeSettlement()` performs **pre-flight compliance and
balance checks** before attempting the atomic token swap. If any check fails,
the settlement is marked as **Failed** (with a descriptive reason emitted via
`SettlementFailed` event) instead of reverting, giving the counterparty clear
feedback.

### Pre-Flight Check Summary

| # | Condition | Failure Reason | Source |
|---|-----------|---------------|--------|
| 1 | Seller's security token balance < required amount | `Seller has insufficient security tokens` | `IERC20.balanceOf()` |
| 2 | Buyer's cash token balance < required amount | `Buyer has insufficient cash tokens` | `IERC20.balanceOf()` |
| 3 | Seller address is frozen | `Seller address is frozen (jurisdiction or sanction)` | `HKSTPSecurityToken.frozen()` |
| 3 | Buyer address is frozen | `Buyer address is frozen (jurisdiction or sanction)` | `HKSTPSecurityToken.frozen()` |
| 4 | Seller is under lock-up period | `Seller is under lock-up period` | `HKSTPCompliance.lockUpEnd(token, seller)` |
| 5 | Seller is not registered / verified | `Seller is not registered or verified` | `HKSTPIdentityRegistry.isVerified()` |
| 5 | Buyer is not registered / verified | `Buyer is not registered or verified` | `HKSTPIdentityRegistry.isVerified()` |

### Behaviour

- **Pre-flight failure**: Transaction succeeds but the settlement status is
  set to `Failed`. The `SettlementFailed(id, matchId, reason)` event is
  emitted. No tokens are moved.
- **Pre-flight pass**: The atomic DvP swap executes (Leg 1: security tokens
  seller → buyer, Leg 2: cash tokens buyer → seller). If either leg fails
  during the actual transfer, the entire transaction reverts.

### Why Graceful Failure?

Previously, compliance or balance errors caused the entire transaction to
revert with an opaque custom error (e.g. `ERC20InsufficientAllowance`),
making it difficult for the counterparty to understand what went wrong.
The pre-flight approach:

1. **Clear feedback** — the failure reason is recorded on-chain and shown
   in the frontend.
2. **Status visibility** — the settlement moves to "Failed" status in the
   UI, rather than remaining "Pending" indefinitely.
3. **No stuck settlements** — counterparties don't need to wait for the
   deadline to expire before the system reflects the failure.

---

## 9. Claim Topics — On-Chain Investor Eligibility Requirements

Every investor must hold a set of **verified claims** before they can
receive, transfer, or trade security tokens. The `isVerified()` function
checks that all required claim topics are present and valid.

### Claim Topic Reference

| Topic ID | Label | Regulatory Basis | Description |
|---|---|---|---|
| 1 | **KYC Verified** | AMLO Part 4 — Customer Due Diligence | Investor's identity has been verified through standard KYC procedures (government ID, proof of address, liveness check). Required for all participants. |
| 2 | **Accredited Investor (Professional Investor)** | SFO Cap. 571, Schedule 1 Part 1 | Investor meets the SFC's Professional Investor threshold: individual portfolio ≥ HKD 8M, corporate portfolio ≥ HKD 8M or assets ≥ HKD 40M. Required because HK STOs are currently restricted to Professional Investors only. |
| 3 | **Jurisdiction Approved** | SFC VATP Conduct Standards, OFAC/HKMA sanctions | Investor's country/jurisdiction is not on a sanctioned or blocked list. Enforced both via claim flag and the `checkModules()` jurisdiction whitelist/blacklist. |
| 4 | **Source of Funds Verified** | AMLO Part 4 — Source of Wealth/Funds | Origin of the investor's funds has been verified as legitimate (bank statements, employment records, business income documentation). Required to prevent money laundering. |
| 5 | **PEP/Sanctions Clear** | AMLO Part 4, FATF Recommendations 12 & 22 | Investor has been screened against Politically Exposed Persons (PEP) lists and international sanctions databases (OFAC SDN, UN, EU, HKMA). Must be clear to participate. |
| 6 | **FPS Name-Match Verified** | SFC VATP Conduct Standards — withdrawal controls | Investor's registered name matches the name on their FPS-linked bank account. Ensures withdrawals return to the verified owner's account (closed-loop AML compliance). |

### How Claims Are Used

- **`isVerified(investor)`** — returns `true` only if **all** required claim
  topics are present and valid for the investor. A single missing or revoked
  claim blocks all token operations.
- **Transfer enforcement** — the security token's `_update()` hook calls
  `isVerified()` on both sender and recipient (unless safe-listed). If either
  party fails, the transfer reverts.
- **Trading gate** — the OrderBook checks `isVerified(msg.sender)` on every
  buy/sell order. Non-verified investors are rejected at order time.
- **Cash transfer gate** — the frontend checks `isVerified(recipient)` before
  allowing cash token (THKD) transfers from the Portfolio page.

### Issuing Claims

Claims can be issued via two paths (see Section 10 below):

1. **Boolean path** — Admin calls `setClaim(investor, topicId, true)` for
   each topic. Lightweight, suitable for development/testing.
2. **ONCHAINID path** — A trusted ClaimIssuer issues signed ERC-735 claims
   with cryptographic proof, expiry, and non-repudiation. Required for
   production.

---

## 10. KYC Verification Paths — Boolean vs ONCHAINID Claims

`isVerified()` in the Identity Registry supports two verification paths.
The path used is determined automatically per investor at call time:

```
investor registered?
  └─ NO  → return false
  └─ YES → has identityContract AND trustedIssuers.length > 0 ?
              └─ YES → ONCHAINID path (cryptographic ERC-735 claims)
              └─ NO  → Boolean path (simple flag per claim topic)
```

### 10.1 Boolean (Simple) Claims

Boolean claims are the lightweight / backward-compatible path. They are used
when **either** of the following is true:

1. **No Identity contract linked** — investor was registered with
   `identityContract = address(0)`.
2. **No Trusted Issuers configured** — the `_trustedIssuers` array on the
   Identity Registry is empty (no `addTrustedIssuer()` has been called).

With the boolean path, verification simply checks that
`_claims[investor][topic] == true` for every required claim topic.

#### Procedure (Boolean Path)

1. Register the investor without an Identity contract:
   `registerIdentity(investor, address(0), "HK")`
2. Set boolean claims for each required topic:
   `setClaim(investor, 1, true)` (KYC),
   `setClaim(investor, 7, true)` (Accredited Investor), etc.
3. `isVerified(investor)` returns `true`.
4. The investor can now receive minted tokens, participate in DvP settlement,
   transfer tokens, and trade on the OrderBook.

### 10.2 ONCHAINID (Cryptographic) Claims

The ONCHAINID path is used when **both** conditions are met:

1. The investor has an **Identity contract** linked
   (`identityContract != address(0)`).
2. At least one **Trusted Issuer** has been added to the Identity Registry.

With this path, verification reads ERC-735 claims from the investor's
Identity contract, validates each claim's cryptographic signature against the
Trusted ClaimIssuer, and checks for revocation and expiry.

#### Procedure (ONCHAINID Path)

1. Deploy or assign an Identity contract for the investor.
2. Register the investor with the Identity contract:
   `registerIdentity(investor, identityAddress, "HK")`
3. Deploy a ClaimIssuer and add it as a Trusted Issuer:
   `addTrustedIssuer(claimIssuerAddress, [1, 7])`
4. Issue signed claims via the ClaimIssuer onto the investor's Identity
   contract (with signature, data, and optional expiry).
5. `isVerified(investor)` returns `true` if valid, non-revoked, non-expired
   claims exist for every required topic from a trusted issuer.

### 10.3 Path Priority

Once an investor has **both** an Identity contract linked **and** Trusted
Issuers are configured, the ONCHAINID path takes priority and boolean claims
are ignored for that investor. Boolean claims set via `setClaim()` will have
no effect on `isVerified()` in this case.

To revert an investor to the boolean path, the Identity contract address
must be cleared (re-register with `address(0)`).

### 10.4 Regulatory Compliance Considerations (Hong Kong)

Hong Kong's SFC and AMLO require KYC/AML due diligence, investor
accreditation, ongoing monitoring, and auditable record-keeping. These are
**off-chain processes** — neither on-chain path performs KYC; they both
record the outcome and enforce transfer restrictions.

| Concern | Boolean (Simple) | ONCHAINID (ERC-735) |
|---|---|---|
| Transfer blocking | ✓ Same enforcement | ✓ Same enforcement |
| Who attests | Admin only (self-attestation) | Independent ClaimIssuer (third-party) |
| Cryptographic proof | None — just a flag | Signed claim with issuer signature |
| Non-repudiation | Weak — admin can flip any flag | Strong — issuer signature is verifiable |
| Claim expiry | Not supported | Built-in (auto-expires) |
| Audit trail | Minimal (on/off event logs) | Rich (issuer, signature, data, expiry) |
| Regulatory inspection | "Admin says investor is verified" | "Licensed KYC provider X attested on date Y, expires Z" |

**Boolean claims do not violate HK regulations** as long as:

- Proper off-chain KYC/AML was conducted and documented.
- The admin setting the boolean flag is authorised and accountable.
- Off-chain records can be produced on regulatory request.

However, Boolean claims represent a **single point of trust** (the admin)
with no cryptographic proof, no expiry, and a weaker audit trail. In a
regulatory inspection, "admin toggled a flag" is harder to defend than
"licensed KYC provider signed cryptographic attestation on [date] with
[evidence hash]".

#### Recommended Usage by Scenario

| Scenario | Recommended Path |
|---|---|
| Production / live STO | **ONCHAINID** — stronger compliance posture |
| Development / testing | **Boolean** — faster iteration, no ClaimIssuer needed |
| Demo / proof-of-concept | **Boolean** — simpler to show the flow |
| Interim (ClaimIssuer temporarily unavailable) | **Boolean** — temporary bridge, upgrade to ONCHAINID later |

The Boolean path exists as a **backward-compatible fallback**, not as a
production-grade compliance solution.

---

## 11. Delegate Votes — Activating On-Chain Voting Power

HKSTPSecurityToken inherits OpenZeppelin's **ERC20Votes**, which tracks
voting power through an explicit **delegation** mechanism rather than raw
token balances. This design is intentional and has important implications.

### Why Delegation Is Required

| Concept | Detail |
|---|---|
| **ERC20Votes model** | Voting power = 0 by default, even if the wallet holds tokens. A holder must call `delegate(address)` to activate voting power. |
| **Self-delegation** | Calling `delegate(myOwnAddress)` activates the holder's own tokens for governance voting. This is the most common case. |
| **Delegate to another** | Calling `delegate(someoneElse)` transfers the holder's **voting weight** (not the tokens themselves) to another address. The delegator retains full token ownership and can transfer or redeem normally. |
| **Snapshot-based** | Voting power is recorded at the block when a proposal is created (`proposalSnapshot`). This prevents **flash-loan attacks** — an attacker cannot borrow tokens, vote, and return them in the same block. |
| **Re-delegation** | A holder can change their delegate at any time. The new delegate's power updates from the next block onward; past proposal snapshots are unaffected. |

### Practical Impact

- **New investor mints tokens → voting power is 0** until they self-delegate
  via the Governance page's "Delegate Votes" button.
- The frontend prompts delegation when `delegates(address)` returns
  `address(0)`, indicating the holder has never delegated.
- Delegation is a one-time transaction per address (persists across
  subsequent mints/transfers unless explicitly changed).

### Why Not Use Balance Directly?

Using raw balances for voting would allow a single token to be counted
multiple times by transferring it between wallets during a voting period.
The delegation + snapshot model ensures each token's voting power is
counted **exactly once** at the proposal snapshot block.

---

## 12. Signaling Proposals — Non-Executable Governance Votes

The Governance page supports two proposal types: **Executable** and
**Signaling**. They serve fundamentally different purposes.

### Executable Proposals (Admin / Agent Only)

Executable proposals encode a real on-chain transaction that is
automatically executed if the vote passes and the timelock delay expires.

| Action | Contract Call |
|---|---|
| Mint tokens | `securityToken.mint(to, amount)` |
| Burn tokens | `securityToken.burn(from, amount)` |
| Set max supply | `securityToken.setMaxSupply(newCap)` |
| Set mint threshold | `securityToken.setMintThreshold(newThreshold)` |
| Pause transfers | `securityToken.pause()` |
| Unpause transfers | `securityToken.unpause()` |

Only users with **Admin** or **Agent** roles can create executable
proposals. This restriction prevents investors from unilaterally
triggering privileged contract operations.

### Signaling Proposals (All Token Holders)

Signaling proposals carry **no on-chain execution payload** — they are
governance votes that record token holder sentiment on the blockchain.

| Aspect | Detail |
|---|---|
| **Who can create** | Any token holder (including start-up companies / investors) |
| **On-chain effect** | None — no contract state changes regardless of outcome |
| **Purpose** | Formal, auditable record of token holder opinion |
| **Binding?** | No — admin decides whether to act on the result |

#### Example Use Cases for Investors

- Request listing of a new security token on the platform
- Propose changes to compliance or KYC requirements
- Signal support or opposition to a strategic direction
- Vote on non-binding resolutions (e.g. dividend policy preferences)

### Why Separate the Two Types?

| Concern | How It's Addressed |
|---|---|
| **Investor voice** | Signaling proposals give every token holder a formal, on-chain mechanism to express their view — without requiring admin privilege. |
| **Security** | Executable proposals are gated to admin/agent, preventing unauthorized minting, burning, or pausing. |
| **Audit trail** | Both types are recorded on-chain with full vote tallies, making governance decisions transparent and verifiable. |
| **Regulatory alignment** | Under HK SFC guidelines, investor participation in governance is encouraged, but privileged operations (supply changes, transfer restrictions) must remain under authorized control. |

---

## 13. Custody Wallet Architecture — Hot / Warm / Cold Tiers

The platform implements a three-tier custody model aligned with
SFC VATP Conduct Standards and VASP requirements. Two on-chain contracts
enforce this architecture:
[`WalletRegistry.sol`](contracts/custody/WalletRegistry.sol) (tier
classification + balance caps) and
[`MultiSigWarm.sol`](contracts/custody/MultiSigWarm.sol) (multi-sig
approval for warm wallet operations).

### Wallet Tiers

| Tier | Connectivity | AUM Share | Security Model | Purpose |
|---|---|---|---|---|
| **HOT** | Always online | **≤ 2%** (enforced on-chain via `hotCapBps = 200`) | Single operational key | Instant settlement — FPS withdrawals, market-making, order fills |
| **WARM** | Partially online | Transient buffer | **2-of-3 multi-sig** (`MultiSigWarm`) | Rebalancing between hot ↔ cold; acts as segregation gate |
| **COLD** | Air-gapped / HSM | **≥ 98%** | FIPS 140-2 Level 3+ HSM, offline signing | Long-term bulk asset storage |

### 98/2 Hot Cap Rule

`WalletRegistry` enforces that hot wallet balances never exceed 2% of total
tracked AUM:

- Every tracked ERC-20 token (security token + cash token) is monitored.
- When a hot wallet receives tokens that would push its balance above the cap,
  a **`SweepRequired`** event is emitted.
- An off-chain custody service listens for this event and triggers an
  automatic sweep to cold storage via the warm wallet.

### Cold Wallet Transfer Restriction

Transfers **from** cold wallets are blocked on-chain. All outbound cold wallet
movements must follow the air-gapped signing workflow:

1. Proposal is created offline on the air-gapped signing device.
2. Signed transaction is transported to the warm wallet.
3. Warm wallet multi-sig validates and routes the funds.

This prevents compromised online systems from draining cold storage.

### Warm Wallet Multi-Sig Workflow (`MultiSigWarm`)

All fund movements through the warm wallet require **2-of-3** approval from
designated signers:

| Step | Action | Who |
|---|---|---|
| 1 | **Propose** — call `proposeTx(token, to, amount, reason)` | Any signer |
| 2 | **Confirm** — call `confirmTx(txId)` | A second signer |
| 3 | **Execute** — call `executeTx(txId)` | Any signer (after 2 confirmations) |

Key safeguards:

- **Auto-expiry**: Unexecuted transactions expire after **48 hours**
  (`EXPIRY_PERIOD`), preventing stale proposals from being executed later.
- **Cancellation**: Any signer can cancel a pending transaction before
  execution.
- **Revocation**: A signer can revoke their confirmation before execution.
- **Reentrancy protection**: The contract uses OpenZeppelin `ReentrancyGuard`.
- **Reason tagging**: Every transfer is tagged with a reason string
  for audit trail (see Transfer Reason Types below).

### Transfer Reason Types

Every warm-wallet `proposeTx` call must specify a **reason** tag. The UI
exposes four predefined reasons, each with a distinct trigger condition,
workflow, and rationale.

#### 1. `sweep-to-cold` — Sweep to Cold Storage

| Aspect | Detail |
|---|---|
| **Direction** | Hot → Warm → Cold |
| **Trigger** | Hot wallet balance exceeds the 2% cap (`SweepRequired` event emitted by `WalletRegistry`) |
| **Rationale** | SFC VATP standards mandate that ≤ 2% of client AUM resides in hot (always-online) wallets. Excess funds must be moved to air-gapped cold storage to minimise exposure to online threats. |
| **Scenario** | After a large token mint or a batch of investor deposits, the hot wallet's balance grows from 1.8% to 3.1% of total AUM. The custody service detects the `SweepRequired` event. A signer proposes `proposeTx(token, coldAddr, excessAmount, "sweep-to-cold")`; a second signer confirms; the transaction executes and the hot balance drops back below 2%. |
| **Condition** | Proposer must be a registered signer. The destination address must be a registered **Cold-tier** wallet in `WalletRegistry`. |

#### 2. `replenish-hot` — Replenish Hot Wallet

| Aspect | Detail |
|---|---|
| **Direction** | Cold → (air-gap sign) → Warm → Hot |
| **Trigger** | Hot wallet liquidity is too low to service pending FPS withdrawals, market-making fills, or order settlements |
| **Rationale** | While cold storage protects the majority of assets, the hot wallet must maintain enough liquidity to fulfil real-time obligations (instant FPS pay-outs, order book fills). Replenishment keeps the platform operational without breaching the 2% cap. |
| **Scenario** | A cluster of investor redemptions drains the hot wallet to 0.3% of AUM. The operations team prepares a signed transaction on the air-gapped cold device, imports it into the warm wallet, and a signer proposes `proposeTx(token, hotAddr, topUpAmount, "replenish-hot")`. After 2-of-3 confirmation the hot wallet is topped up to ~1.5%. |
| **Condition** | The pre-signed cold-wallet transaction must first deposit funds into the warm wallet. The destination must be a registered **Hot-tier** wallet. The resulting hot balance must still be ≤ 2% of AUM after the transfer. |

#### 3. `withdrawal` — Client Withdrawal

| Aspect | Detail |
|---|---|
| **Direction** | Warm → External (investor / redemption address) |
| **Trigger** | An approved client redemption or off-platform withdrawal request that exceeds hot wallet liquidity or requires warm-wallet authorisation |
| **Rationale** | Large or out-of-band withdrawals (e.g., institutional block redemptions, regulatory-mandated asset returns) may require manual warm-wallet disbursement with multi-sig approval to maintain segregation controls and provide an auditable sign-off trail. |
| **Scenario** | An institutional investor submits a block redemption of 500 000 tokens. The compliance team verifies the request off-chain, and a signer proposes `proposeTx(token, investorAddr, 500000e18, "withdrawal")`. A second signer reviews the compliance ticket and confirms; a third executes. |
| **Condition** | The destination must pass compliance verification (registered, verified, not frozen in the Identity Registry). The withdrawal amount must not cause the platform's reserve to fall below minimum thresholds. |

#### 4. `rebalance` — General Rebalance

| Aspect | Detail |
|---|---|
| **Direction** | Any inter-tier movement (Hot ↔ Warm, Warm ↔ Cold, or lateral between wallets of the same tier) |
| **Trigger** | Periodic portfolio rebalancing, wallet rotation, infrastructure migration, or post-incident key-rotation |
| **Rationale** | Operational maintenance may require moving funds between wallets that don't fit the sweep or replenish patterns — for example rotating a compromised hot key to a fresh hot wallet, consolidating balances across multiple cold wallets, or redistributing assets after a token factory creates a new security token. A generic `rebalance` reason provides a catch-all audit tag for these operations. |
| **Scenario** | The platform rotates its hot-wallet key as a precautionary measure. A signer proposes `proposeTx(token, newHotAddr, fullBalance, "rebalance")` to migrate all funds from the old hot wallet to the new one. A second signer confirms. The old wallet is then deactivated via `deactivateWallet()` in `WalletRegistry`. |
| **Condition** | Both source and destination must be registered wallets (active) in `WalletRegistry`. The resulting tier balances must still satisfy the 98/2 rule after the move. |

### Rebalancing Flow

```
  ┌──────────┐     sweep-to-cold     ┌──────────┐    air-gap     ┌──────────┐
  │   HOT    │ ───────────────────→  │   WARM   │ ────────────→  │   COLD   │
  │  (≤ 2%)  │                       │  (2-of-3 │                │  (≥ 98%) │
  │          │ ←───────────────────  │  multisig)│ ←────────────  │          │
  └──────────┘     replenish-hot     └──────────┘    air-gap     └──────────┘
```

- **Auto-sweep** (hot → cold via warm): Triggered when hot balance exceeds
  2% cap. The custody operator proposes a sweep through the warm wallet;
  a second signer confirms; funds move to cold storage.
- **Replenish** (cold → hot via warm): When hot wallet needs liquidity,
  funds are signed offline from cold, routed through warm multi-sig, then
  deposited to hot.

### Access Control

| Role | Contract | Permissions |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | `WalletRegistry` | Register/deactivate wallets, set hot cap, add/remove tracked tokens |
| `OPERATOR_ROLE` | `WalletRegistry` | Execute sweeps, record rebalance operations |
| Signer (1 of 3) | `MultiSigWarm` | Propose, confirm, revoke, execute, cancel transactions |

### Regulatory Alignment

| Requirement | Implementation |
|---|---|
| **SFC VATP — Segregation of client assets** | Three-tier architecture with on-chain enforcement; cold storage is air-gapped |
| **SFC VATP — Hot wallet cap** | `hotCapBps = 200` (2%) enforced by `WalletRegistry` with `SweepRequired` events |
| **VASP — Multi-signature custody** | Warm wallet requires 2-of-3 approval via `MultiSigWarm` |
| **VASP — Audit trail** | All sweep/rebalance operations are logged on-chain (`SweepRecord[]`) with timestamps and reason codes |
| **FIPS 140-2 Level 3+ HSM** | Cold wallet signing occurs on certified hardware; on-chain contract blocks direct cold transfers |

---

## Safe-Listed Status (Portfolio Page)

The Portfolio page displays four identity/compliance indicators for the
connected wallet: **Registered**, **Verified**, **Frozen**, and
**Safe-Listed**. These statuses serve different purposes:

| Status | Meaning | Who Gets It |
|---|---|---|
| **Registered** | Address exists in the Identity Registry | All onboarded investors |
| **Verified** | KYC / claim-topic attestations are valid | All compliant investors |
| **Frozen** | All transfers blocked for this address | Addresses flagged by admin |
| **Safe-Listed** | Bypasses compliance checks entirely on transfers | Only system contracts / operational wallets (treasury, escrow, OrderBook, custody) |

### Why Is My Account Not Safe-Listed?

**Normal investor accounts should always show "Safe-Listed: No".** This is
the correct and expected state.

Safe-listing is an **admin-only privilege** granted via
`setSafeList(address, bool)` on `HKSTPSecurityToken`. It is reserved for
trusted infrastructure addresses (e.g. OrderBook escrow contracts, treasury,
custody wallets) so they can move tokens without triggering KYC checks on
themselves. It is **not** part of the investor onboarding flow.

### How Safe-Listing Affects Transfers

The `_update()` hook in `HKSTPSecurityToken` evaluates safe-listed status on
every mint, burn, and transfer:

- If **both** sender and recipient are safe-listed → the entire compliance
  pipeline (identity registry, claim checks, concentration caps) is skipped.
- If **only one** side is safe-listed → the other party still undergoes full
  compliance verification.
- If **neither** side is safe-listed → both parties must be registered,
  verified, and pass all compliance module checks.

### Summary

An investor with **Registered: Yes**, **Verified: Yes**, **Safe-Listed: No**
is fully compliant and can trade normally. The compliance pipeline verifies
their identity on each transfer and allows it through because they are
registered and verified. No action is required to change the safe-listed
status for investor accounts.
