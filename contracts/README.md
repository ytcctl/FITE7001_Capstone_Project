# TokenHub Smart Contracts

> Permissioned security token platform integrated with Hong Kong Science & Technology Parks (HKSTP) for fractional equity tokenization and atomic DvP settlement.

## Architecture Overview

TokenHub operates on a **Hyperledger Besu** permissioned network (EVM-compatible) with four validator nodes — HKSTP, Platform Operator, Licensed Custodian, and Regulator Observer.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    INVESTOR PORTAL  (React/Next.js)                  │
│   SSO+MFA │ KYC Upload │ Wallet │ Order Book │ Portfolio View        │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
          ┌─────────────────────────▼───────────────────────┐
          │          COMPLIANCE SERVICE (Oracle)             │
          │  Signs per-transfer EIP-712 attestations         │
          │  Checks: KYC status, lock-up, caps, jurisdiction │
          └─────────────────────────┬───────────────────────┘
                                    │
          ┌─────────────────────────▼───────────────────────┐
          │        HYPERLEDGER BESU (Permissioned EVM)       │
          │                                                   │
          │  ┌───────────────────┐  ┌─────────────────────┐  │
          │  │ HKSTPSecurityToken│  │ HKSTPIdentityRegistry│  │
          │  │  (ERC-3643 style) │  │  (KYC/AML claims)   │  │
          │  └────────┬──────────┘  └──────────┬──────────┘  │
          │           │                         │             │
          │  ┌────────▼──────────┐  ┌──────────▼──────────┐  │
          │  │  HKSTPCompliance  │  │   DvPSettlement      │  │
          │  │  (attestation +   │  │   (atomic Leg1+Leg2) │  │
          │  │   module checks)  │  │                      │  │
          │  └───────────────────┘  └──────────────────────┘  │
          │                                                   │
          │  ┌───────────────────┐                            │
          │  │  MockCashToken    │  (tokenized HKD / THKD)    │
          │  │  (ERC-20 mock)    │                            │
          │  └───────────────────┘                            │
          └───────────────────────────────────────────────────┘
```

## Contract Descriptions

### `HKSTPSecurityToken.sol`
ERC-3643 (T-REX) inspired security token — **one token per HKSTP portfolio startup**.

| Feature | Description |
|---------|-------------|
| Transfer control | Every transfer checks Identity Registry + Compliance modules |
| Safe-list | Operational addresses (treasury, escrow) bypass per-transfer attestation |
| Minting/Burning | Only addresses with `AGENT_ROLE` (licensed custodians) |
| Pause | Admin can emergency-pause all transfers |
| Freeze | Agents can freeze individual addresses |

### `HKSTPIdentityRegistry.sol`
Maps investor wallet addresses to ONCHAINID identity contracts (ERC-734/735 style).

| Claim Topic | Description |
|-------------|-------------|
| 1 | KYC Verified |
| 2 | Accredited Investor |
| 3 | Jurisdiction Approved (HK / non-sanctioned) |
| 4 | Source of Funds Verified |
| 5 | PEP/Sanctions Clear |

### `HKSTPCompliance.sol`
Modular compliance contract — "**Policy off-chain, enforcement on-chain**".

- **EIP-712 attestation** — Per-transfer signed approval from Compliance Oracle, bound to `(from, to, amount, expiry, nonce)`
- **Replay protection** — Each attestation hash is one-time-use
- **Modules** — Concentration caps, jurisdiction whitelist/blacklist, lock-up enforcement

### `DvPSettlement.sol`
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

### `mocks/MockCashToken.sol`
Simple ERC-20 representing tokenized HKD (Project Ensemble / FPS-backed stablecoin simulation).

---

## Contract Interaction Diagram

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
      │                                │    (module checks)        │
      │                                │                           │
      │         transferFrom(buyer→seller) ──►  MockCashToken      │
      │◄───────────── THKD received ───│                           │
      │                                │      security token ─────►│
```

---

## Setup & Installation

### Prerequisites
- Node.js ≥ 18
- npm ≥ 9

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

## Testing

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

### Test suites

| File | Coverage |
|------|---------|
| `test/HKSTPSecurityToken.test.js` | Deployment, minting, transfers, safe-list, pause, freeze |
| `test/HKSTPCompliance.test.js` | Attestation verify/consume, replay protection, module checks |
| `test/DvPSettlement.test.js` | Settlement lifecycle, atomic execution, deadline, pause |

---

## Deployment

### Local Hardhat Network

```bash
npx hardhat node &
npm run deploy:local
```

### Hyperledger Besu Testnet

```bash
export BESU_RPC_URL="http://<besu-node>:8545"
export BESU_PRIVATE_KEYS="<deployer-private-key>"
export COMPLIANCE_ORACLE="<oracle-address>"
export TREASURY_ADDRESS="<treasury-address>"
export ESCROW_ADDRESS="<escrow-address>"
export CUSTODIAN_ADDRESS="<custodian-address>"

npm run deploy:besu
```

### Deployment order

1. `HKSTPIdentityRegistry` — KYC/AML claim storage
2. `HKSTPCompliance` — attestation + module enforcement
3. `HKSTPSecurityToken` — linked to registry + compliance
4. `MockCashToken` — tokenized HKD (replace with real Project Ensemble contract in production)
5. `DvPSettlement` — atomic settlement engine

### Post-deployment steps

1. Grant `TOKEN_ROLE` on `HKSTPCompliance` to `HKSTPSecurityToken`
2. Grant `AGENT_ROLE` on `HKSTPSecurityToken` to licensed custodian wallets
3. Safe-list treasury, escrow, and custody addresses
4. Grant `OPERATOR_ROLE` on `DvPSettlement` to the matching engine service account
5. Register investor identities via `HKSTPIdentityRegistry.registerIdentity()`
6. Set KYC claims via `HKSTPIdentityRegistry.setClaim()`

---

## Security Considerations

- All transfers are gated by the Identity Registry (both parties must be KYC-verified)
- Compliance module checks run on every non-safe-listed transfer
- DvP uses `ReentrancyGuard` to prevent re-entrancy attacks
- Emergency pause available on both the token and DvP contract
- Attestations are one-time-use (replay protection via nonce + used-hash mapping)
- `AccessControl` used throughout — role-based, no single-owner risk
- Follows checks-effects-interactions pattern in `executeSettlement()`

---

## SFC Regulatory Alignment

| Requirement | Implementation |
|-------------|----------------|
| Investor suitability | `HKSTPIdentityRegistry` — 5 claim topics required |
| Transfer restrictions | `HKSTPCompliance` — jurisdiction, lock-up, concentration caps |
| Settlement finality | `DvPSettlement` — atomic single-transaction, immutable audit trail |
| Emergency intervention | `pause()` on token and DvP (PAUSER_ROLE / DEFAULT_ADMIN_ROLE) |
| Audit trail | Events on every state change across all contracts |
