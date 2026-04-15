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

## 8. KYC Verification Paths — Boolean vs ONCHAINID Claims

`isVerified()` in the Identity Registry supports two verification paths.
The path used is determined automatically per investor at call time:

```
investor registered?
  └─ NO  → return false
  └─ YES → has identityContract AND trustedIssuers.length > 0 ?
              └─ YES → ONCHAINID path (cryptographic ERC-735 claims)
              └─ NO  → Boolean path (simple flag per claim topic)
```

### 8.1 Boolean (Simple) Claims

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

### 8.2 ONCHAINID (Cryptographic) Claims

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

### 8.3 Path Priority

Once an investor has **both** an Identity contract linked **and** Trusted
Issuers are configured, the ONCHAINID path takes priority and boolean claims
are ignored for that investor. Boolean claims set via `setClaim()` will have
no effect on `isVerified()` in this case.

To revert an investor to the boolean path, the Identity contract address
must be cleared (re-register with `address(0)`).

### 8.4 Regulatory Compliance Considerations (Hong Kong)

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

## 9. Delegate Votes — Activating On-Chain Voting Power

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

## 10. Signaling Proposals — Non-Executable Governance Votes

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
