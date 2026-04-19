# Token Management

## Token Factory Architecture

The platform supports two token factory types:

| Factory | Standard | Upgradeability | Contract |
|---------|----------|----------------|----------|
| **V1 — Immutable Clones** | EIP-1167 minimal proxies | Not upgradeable | `TokenFactory.sol` |
| **V2 — Upgradeable Proxies** | ERC-1967 proxies | Admin-upgradeable | `TokenFactoryV2.sol` |

All tokens are **ERC-3643** compliant security tokens linked to the shared KYC Identity Registry and Compliance engine.

---

## V1 — Immutable Clones (EIP-1167)

- Deploys lightweight minimal proxy clones
- Each token is a permanent, immutable copy of the implementation at creation time
- Lower gas cost for deployment
- **Cannot** be upgraded after deployment

## V2 — Upgradeable Proxies (ERC-1967)

- Deploys full ERC-1967 transparent proxies
- All V2 tokens share a single `currentImplementation` stored on `TokenFactoryV2`
- Can be upgraded atomically — all V2 tokens move to a new implementation in one transaction
- Token addresses remain the same after upgrade; only the logic changes

---

## Upgrade All Token Implementations (V2)

### Overview

`TokenFactoryV2.upgradeImplementation(address newImplementation)` upgrades **all** deployed V2 token proxies to a new implementation contract in a single atomic transaction.

### Access Control

| Role | Purpose |
|------|---------|
| `UPGRADER_ROLE` | Required to call `upgradeImplementation()`. Should be assigned to the **Timelock** contract so upgrades go through governance. |
| `DEFAULT_ADMIN_ROLE` | Can create tokens, manage factory settings |

### Contract Behaviour

1. Validates the new address is non-zero and different from the current implementation
2. Updates `currentImplementation` storage variable
3. Loops through all `deployedProxies[]` and calls `upgradeTo(newImplementation)` on each ERC-1967 proxy
4. If a single proxy call fails, it continues (non-reverting) to avoid blocking the entire batch
5. Emits `ImplementationUpgraded(previousImpl, newImpl, count)`

### Step-by-Step: Deploying a New Implementation

#### 1. Modify the implementation contract

Edit `contracts/HKSTPSecurityToken.sol` with the desired changes (bug fix, new feature, etc.).

> **Storage compatibility rule:** Only **append** new state variables at the end. Never reorder, rename, or remove existing storage variables — this would corrupt proxy storage.

#### 2. Compile

```bash
npx hardhat compile
```

#### 3. Deploy the new implementation (logic contract only)

```bash
npx hardhat console --network localhost
```

```js
const Token = await ethers.getContractFactory("HKSTPSecurityToken");
const newImpl = await Token.deploy();
await newImpl.waitForDeployment();
console.log("New implementation:", await newImpl.getAddress());
```

This deploys the **bare logic contract** (not a proxy). It does not need to be initialized — proxies already hold their own storage.

#### 4. Use the address in the UI

1. Navigate to **Token Management → V2 — Upgradeable Proxies** tab
2. Under **"Upgrade All Token Implementations"**, paste the new implementation address
3. Click **"Upgrade Implementation"**
4. On success: all V2 proxies now point to the new logic contract

### Important Notes

- The caller must have `UPGRADER_ROLE` on `TokenFactoryV2`. In production, this should be the Timelock, meaning upgrades require a **governance proposal** to be created, voted on, and executed.
- The current implementation address is displayed at the top of the V2 tab for reference.
- The new implementation must be **audited** and **storage-compatible** with the previous version.
- The UI warns: _"This upgrades ALL N V2 token(s) atomically."_

---

## Frontend: Token Management Page

### V1 Tab
- **Create New Startup Token** — deploys an immutable EIP-1167 clone
- **V1 Token List** — shows all V1 tokens with name, symbol, address, supply, status
- **Deactivate / Reactivate** — toggles token active status

### V2 Tab
- **Current Implementation** — displays the current shared implementation address
- **Create Upgradeable Token** — deploys a new ERC-1967 proxy
- **Upgrade All Token Implementations** — batch-upgrades all V2 proxies
- **V2 Token List** — shows all V2 tokens with proxy address, status, and `UPGRADEABLE` badge
