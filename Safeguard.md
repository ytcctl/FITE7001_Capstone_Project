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
