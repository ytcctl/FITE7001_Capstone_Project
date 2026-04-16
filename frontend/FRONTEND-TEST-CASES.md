# Frontend Functional Test Cases — TokenHub HKSTP Security Token Suite

## Test Environment Prerequisites

| Item | Details |
|------|---------|
| Blockchain | Hardhat Devnet (Chain ID 31337) running locally or via Codespaces |
| Contracts | All contracts deployed via `npx hardhat run scripts/deploy-and-update-frontend.js --network localhost` |
| Wallets | Admin wallet (deployer), Agent wallet, Operator wallet, 2+ Investor wallets |
| Browser | MetaMask installed and configured for Hardhat Devnet |

---

## 1. Wallet Connection & Network (Web3Context / Layout)

### 1.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| W-P-01 | Connect via MetaMask | Click wallet menu → "MetaMask" | Wallet connects, address displayed, role badge shown, chain ID = 31337 | Critical | | |
| W-P-02 | Connect via test account | Click wallet menu → select pre-loaded test account | Wallet connects with test account address, correct role detected | Critical | | |
| W-P-03 | Connect via custom private key | Enter valid `0x` + 64 hex chars → "Connect" | Wallet connects, address derived correctly, account saved to localStorage | High | | |
| W-P-04 | Disconnect wallet | Click wallet → "Disconnect" | Address cleared, UI reverts to "Connect Wallet" state, routes unprotected | Critical | | |
| W-P-05 | Switch between accounts | Connect Account A → switch to Account B via wallet menu | Address updates, roles recalculated, balances refreshed | High | | |
| W-P-06 | Auto-reconnect on page reload | Connect wallet → reload page | Wallet automatically reconnects, same account restored | Medium | | |
| W-P-07 | Save custom account with label | Enter private key + label "Test Investor" → connect | Account appears in saved accounts list with label | Low | | |
| W-P-08 | Remove saved account | Click ✕ button on saved account entry | Account removed from saved list and localStorage | Low | | |
| W-P-09 | Network switch prompt | Connect on wrong network → click "Switch Network" | MetaMask prompts to add/switch to Besu Devnet (chain 31337) | High | | |
| W-P-10 | Role detection — admin | Connect with deployer key | `roles.isAdmin = true`, admin routes accessible | Critical | | |
| W-P-11 | Role detection — agent | Connect with agent key | `roles.isAgent = true`, badge shows "AGENT" (orange), KYC/Mint/Oracle routes accessible, Compliance/Tokens/Markets/Custody hidden | Critical | | |
| W-P-12 | Role detection — investor | Connect with regular wallet | `roles.isAdmin = false, isAgent = false`, admin routes hidden | Critical | | |
| W-P-13 | Role detection — operator | Connect with operator key | `roles.isOperator = true`, badge shows "OPERATOR" (green), Settlement/Oracle accessible, KYC/Mint/Compliance/Tokens/Markets/Custody hidden | Critical | | |

### 1.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| W-N-01 | Invalid private key format | Enter "abc123" in custom key field → submit | Error: "Invalid private key format", connection not attempted | High | | |
| W-N-02 | Short private key | Enter `0x` + 60 hex chars | Error: "Invalid private key format" | Medium | | |
| W-N-03 | Private key with invalid chars | Enter `0x` + 64 chars including `g`, `z` | Error: "Invalid private key format" | Medium | | |
| W-N-04 | MetaMask not installed | Open in browser without MetaMask → click MetaMask | MetaMask option hidden or error message displayed | Medium | | |
| W-N-05 | User rejects MetaMask connection | Click MetaMask → reject permission request | No crash, wallet remains disconnected | High | | |
| W-N-06 | Wrong network connected | Connect MetaMask on Ethereum mainnet (chain 1) | Yellow banner: "Wrong Network" with switch button, routes accessible but data may be unavailable | Critical | | |
| W-N-07 | Connect with empty private key | Leave key field empty → submit | Error message or button disabled | Low | | |
| W-N-08 | RPC node unreachable | Stop Besu node → attempt to connect | Graceful error, role detection defaults to no roles | High | | |
| W-N-09 | Investor route access to `/kyc` | Connect as investor → navigate to `/kyc` directly via URL | Redirected to Dashboard, admin page not rendered | Critical | | |
| W-N-10 | Investor route access to `/mint` | Connect as investor → navigate to `/mint` via URL | Redirected to Dashboard | Critical | | |
| W-N-11 | Investor route access to `/compliance` | Connect as investor → navigate to `/compliance` via URL | Redirected to Dashboard | Critical | | |
| W-N-12 | Investor route access to `/custody` | Connect as investor → navigate to `/custody` via URL | Redirected to Dashboard | Critical | | |
| W-N-13 | Agent route access to `/compliance` | Connect as agent → navigate to `/compliance` via URL | Redirected to Dashboard (Agent has no on-chain role on Compliance) | Critical | | |
| W-N-14 | Agent route access to `/tokens` | Connect as agent → navigate to `/tokens` via URL | Redirected to Dashboard (Agent has no on-chain role on TokenFactory) | Critical | | |
| W-N-15 | Agent route access to `/markets` | Connect as agent → navigate to `/markets` via URL | Redirected to Dashboard (Agent has no on-chain role on OrderBookFactory) | Critical | | |
| W-N-16 | Agent route access to `/custody` | Connect as agent → navigate to `/custody` via URL | Redirected to Dashboard (Agent has no on-chain role on WalletRegistry) | Critical | | |
| W-N-17 | Operator route access to `/kyc` | Connect as operator → navigate to `/kyc` via URL | Redirected to Dashboard (Operator has no AGENT_ROLE on IdentityRegistry) | Critical | | |
| W-N-18 | Operator route access to `/mint` | Connect as operator → navigate to `/mint` via URL | Redirected to Dashboard (Operator has no AGENT_ROLE on SecurityToken) | Critical | | |
| W-N-19 | Operator route access to `/compliance` | Connect as operator → navigate to `/compliance` via URL | Redirected to Dashboard (Operator has no role on Compliance) | Critical | | |
| W-N-20 | Operator route access to `/tokens` | Connect as operator → navigate to `/tokens` via URL | Redirected to Dashboard (Operator has no role on TokenFactory) | Critical | | |
| W-N-21 | Operator route access to `/markets` | Connect as operator → navigate to `/markets` via URL | Redirected to Dashboard (Operator has no role on OrderBookFactory) | Critical | | |
| W-N-22 | Operator route access to `/custody` | Connect as operator → navigate to `/custody` via URL | Redirected to Dashboard (Operator has no role on WalletRegistry) | Critical | | |

---

## 2. Dashboard

### 2.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| D-P-01 | Display token balances | Connect wallet with token holdings | Security token balance, cash token balance, total supply displayed correctly | High | | |
| D-P-02 | KYC status — verified | Connect KYC-verified wallet | Green "Verified" badge shown | High | | |
| D-P-03 | KYC status — registered only | Connect registered but unverified wallet | "Registered" badge shown (not verified) | Medium | | |
| D-P-04 | KYC claims grid | Connect verified wallet with all claims | All 6 claim topics show "Active" status | Medium | | |
| D-P-05 | System health check (admin) | Connect admin → click "Run Health Check" | Health report shows total/passed/failed counts, individual results in grid | High | | |
| D-P-06 | Health check all passing | All contracts deployed correctly → run health check | "Healthy" status (green indicator), all checks show ✓ | Medium | | |
| D-P-07 | Zero balances display | Connect new wallet with no tokens | Balances show "0" or "0.0", not errors | Medium | | |

### 2.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| D-N-01 | No wallet connected | Open Dashboard without connecting | "Connect Wallet" banner shown, no data loaded | High | | |
| D-N-02 | KYC status — not registered | Connect wallet that was never registered | "Not Registered" status displayed | Medium | | |
| D-N-03 | Health check non-admin | Connect as investor | Health check section hidden or button disabled | High | | |
| D-N-04 | Health check failure | Contract address misconfigured → run health check | Red banner: "Health check failed", graceful error message | Medium | | |
| D-N-05 | Partial data fetch failure | One contract call fails (e.g. compliance down) | Other data still renders, failed fields show `—` placeholder | Medium | | |
| D-N-06 | Claims partially missing | Wallet has KYC but not Accredited claim | Partial claims: "Active" for KYC, "Missing" for Accredited | Medium | | |

---

## 3. KYC Management (Admin)

### 3.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| K-P-01 | Register new identity | Enter valid address + "HK" → "Register Identity" | Tx succeeds, green status: "✓ Identity registered", investor now in registry | Critical | | |
| K-P-02 | Issue signed ERC-735 claim | Select investor + "KYC Verified" + Signed mode → submit | Tx succeeds, claim issued with cryptographic signature, status green | Critical | | |
| K-P-03 | Set boolean claim | Select investor + "Accredited Investor" + Boolean mode + Set → submit | Tx succeeds, boolean claim set to true | High | | |
| K-P-04 | Revoke boolean claim | Select investor + claim topic + Boolean mode + Revoke → submit | Tx succeeds, claim revoked (set to false) | High | | |
| K-P-05 | Identity lookup — registered | Enter registered address → "Look Up" | Shows: Registered ✓, Verified status, Country, ONCHAINID, all 6 claim statuses | High | | |
| K-P-06 | Issue all 6 claim types | For each of the 6 topics, issue a claim | All 6 claims show "Active" in lookup | High | | |
| K-P-07 | Country code uppercase | Enter "hk" as country → submit | Auto-uppercased to "HK" before submission | Low | | |
| K-P-08 | Multiple registrations | Register Address A, then Address B | Both succeed, both appear in registry | Medium | | |

### 3.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| K-N-01 | Register duplicate identity | Register same address twice | Tx reverts, error message displayed (e.g., "already registered") | High | | |
| K-N-02 | Invalid investor address | Enter "not-an-address" → Register | Tx fails, error message shown | Medium | | |
| K-N-03 | Empty address field | Leave address empty → click Register | Button disabled or error message | Medium | | |
| K-N-04 | Claim on unregistered investor | Issue claim for address not in registry | Error: "Investor has no ONCHAINID contract. Register first." | High | | |
| K-N-05 | Signed claim but no ONCHAINID | Select signed mode for investor without ONCHAINID | Error message about missing identity contract | High | | |
| K-N-06 | Lookup non-existent address | Enter unregistered address → Look Up | Shows: Not Registered, all claims "Missing" | Medium | | |
| K-N-07 | Country code > 2 chars | Enter "HKG" as country code | Input limited to 2 chars, only "HK" accepted | Low | | |
| K-N-08 | Non-admin access | Connect as investor → navigate to KYC page | Route guard redirects to Dashboard | Critical | | |
| K-N-09 | Register with zero address | Enter `0x0000...0000` as investor address | Contract rejects, error displayed | Medium | | |
| K-N-10 | Transaction rejected by user | Start registration → reject in MetaMask | Error displayed, form state preserved for retry | Medium | | |

---

## 4. Token Management (Admin)

### 4.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| T-P-01 | Create new token | Enter "BioTech Alpha Token" + "BAT" → Create | Tx succeeds, shows new token address from `TokenCreated` event | Critical | | |
| T-P-02 | Token symbol auto-uppercase | Enter "bat" as symbol | Automatically uppercased to "BAT" | Low | | |
| T-P-03 | Token list refresh | Create token → check token list | New token appears with name, symbol, address, supply = 0 | High | | |
| T-P-04 | Copy token address | Click copy button on token row | Address copied to clipboard | Low | | |
| T-P-05 | Deactivate token | Click "Deactivate" on active token | Token status changes to inactive | High | | |
| T-P-06 | Reactivate token | Click "Reactivate" on deactivated token | Token status changes back to active | High | | |
| T-P-07 | Multiple tokens | Create 3 different tokens | All 3 appear in token list with correct data | Medium | | |

### 4.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| T-N-01 | Duplicate token symbol | Create token "BAT", then create another "BAT" | Error: "Symbol `BAT` already exists. Choose a different symbol." | High | | |
| T-N-02 | Empty token name | Leave name empty → Create | Error: "Token name and symbol cannot be empty." or button disabled | Medium | | |
| T-N-03 | Empty token symbol | Leave symbol empty → Create | Error or button disabled | Medium | | |
| T-N-04 | Symbol > 10 characters | Enter "VERYLONGSYMBOL" (14 chars) | Input limited to 10 chars | Low | | |
| T-N-05 | Non-admin create token (investor) | Connect as investor → try to create token | Route guard blocks access | Critical | | |
| T-N-06 | Non-admin create token (agent) | Connect as agent → try to create token | Route guard blocks access (Agent has no TokenFactory role) | Critical | | |
| T-N-07 | Transaction failure | Create token with contract error → check UI | Error message displayed, form state preserved | Medium | | |

---

## 5. Token Minting (Admin)

### 5.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| M-P-01 | Mint security tokens | Select token → enter recipient + amount → Mint | Tx succeeds, recipient balance increases, total supply updates | Critical | | |
| M-P-02 | Burn security tokens | Enter holder address + amount → Burn | Tx succeeds, holder balance decreases, total supply decreases | Critical | | |
| M-P-03 | Mint cash tokens | Enter recipient + amount → Mint Cash | Tx succeeds, recipient receives THKD tokens | Critical | | |
| M-P-04 | Burn cash tokens | Enter holder address + amount → Burn Cash | Tx succeeds, cash token burned | Critical | | |
| M-P-05 | Set max supply cap | Enter 1000000 → "Set Cap" | Cap set, displayed in UI as current max supply | High | | |
| M-P-06 | Set mint threshold | Enter 100000 → "Set Threshold" | Threshold set, displayed in UI | High | | |
| M-P-07 | Switch between tokens | Select different token from dropdown | Token info refreshes: name, symbol, supply, cap, threshold | Medium | | |
| M-P-08 | Set unlimited supply | Enter 0 for max supply → "Set Cap" | Cap interpreted as unlimited | Medium | | |
| M-P-09 | Mint to multiple recipients | Mint 100 to Address A, then 200 to Address B | Both receive correct amounts, supply reflects total | High | | |

### 5.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| M-N-01 | Mint exceeding max supply | Set cap to 1000 → try to mint 1001 | Tx reverts, error message about exceeding cap | Critical | | |
| M-N-02 | Burn more than balance | Holder has 100 → try to burn 200 | Tx reverts, error about insufficient balance | High | | |
| M-N-03 | Mint to invalid address | Enter "xyz" as recipient → Mint | Error about invalid address format | Medium | | |
| M-N-04 | Mint zero amount | Enter 0 tokens → Mint | Tx reverts or validation error | Medium | | |
| M-N-05 | Negative amount | Enter -100 → Mint | Input validation rejects or parseUnits fails | Medium | | |
| M-N-06 | Non-numeric amount | Enter "abc" → Mint | parseUnits fails, error displayed | Medium | | |
| M-N-07 | Mint without admin role | Connect as investor → attempt mint | No access to page (route guard) | Critical | | |
| M-N-08 | Set cap below current supply | Supply is 500 → try to set cap to 100 | Tx reverts, error about cap below supply | High | | |
| M-N-09 | Mint to non-KYC address | Mint to unregistered address | Tx may revert depending on compliance module | High | | |
| M-N-10 | No token selected | Don't select token → try mint | Button disabled or error message | Low | | |

---

## 6. Trading (Order Book)

### 6.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| TR-P-01 | Select market | Open Trading → select market from dropdown | Market loads: order book, stats, balance display | High | | |
| TR-P-02 | Place buy order | Select Buy → enter price 10, qty 5 → submit | Tx succeeds (after cash approval), order appears in "My Orders" as Open | Critical | | |
| TR-P-03 | Place sell order | Select Sell → enter price 10, qty 5 → submit | Tx succeeds (after token approval), order appears in "My Orders" as Open | Critical | | |
| TR-P-04 | Order auto-match | Place buy at 10, then sell at 10 (different wallets) | Trade executes, appears in "Recent Trades" | Critical | | |
| TR-P-05 | Cancel open order | Place order → click Cancel on "My Orders" row | Order status changes to Cancelled | High | | |
| TR-P-06 | Order book display | Place multiple buy/sell orders at different prices | Bid orders (descending), Ask orders (ascending), Spread shown between them | Medium | | |
| TR-P-07 | Estimated total calculation | Enter price 10, qty 5 | "Estimated Total: 50 HKD" displayed | Low | | |
| TR-P-08 | Cash approval for buy | Buy order with insufficient allowance | MetaMask prompts for approval, then order placed | Critical | | |
| TR-P-09 | Token approval for sell | Sell order with insufficient allowance | MetaMask prompts for approval, then order placed | Critical | | |
| TR-P-10 | Auto-refresh data | Wait 5+ seconds after placing order | Order book, trades, stats refresh automatically | Medium | | |
| TR-P-11 | Partial fill display | Order partially matched | "My Orders" shows filled qty < total qty, status "PartiallyFilled" | Medium | | |
| TR-P-12 | Recent trades time format | Trade executed 5 minutes ago | Shows "5m ago" in relative time | Low | | |
| TR-P-13 | 24h price change | Multiple trades over 24h period | Daily change percentage calculated and displayed | Low | | |
| TR-P-14 | Balance display | Connect wallet with holdings | Security token balance and cash balance shown above form | Medium | | |

### 6.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| TR-N-01 | Trade without KYC | Connect non-KYC wallet → try to place order | Red banner: "Your wallet has not passed KYC verification...", form submission blocked | Critical | | |
| TR-N-02 | Buy with zero price | Enter price = 0 → submit | Validation error, order not submitted | Medium | | |
| TR-N-03 | Sell with zero quantity | Enter quantity = 0 → submit | Validation error, order not submitted | Medium | | |
| TR-N-04 | Sell more than balance | Hold 10 tokens → try to sell 100 | Tx reverts, error about insufficient balance | High | | |
| TR-N-05 | Buy without cash balance | Cash balance = 0 → try to buy | Approval or order tx reverts | High | | |
| TR-N-06 | Cancel filled order | Order fully filled → try cancel | Cancel button not shown for "Filled" orders | Medium | | |
| TR-N-07 | Cancel already cancelled order | Order cancelled → try cancel again | Cancel button not shown for "Cancelled" orders | Low | | |
| TR-N-08 | No markets available | No order books created → open Trading | Empty market dropdown, message "No markets available" | Medium | | |
| TR-N-09 | KYC checking state | Fresh load, KYC check in progress | Loading indicator shown, form disabled until check completes | Medium | | |
| TR-N-10 | Negative price input | Enter -5 as price | Validation rejects or parseUnits fails | Medium | | |
| TR-N-11 | Very large order | Place order for 10^18 tokens | Tx reverts (exceeds supply), error handled gracefully | Medium | | |
| TR-N-12 | Approve rejected by user | Approval MetaMask popup → user rejects | Error shown, order not placed, state preserved for retry | High | | |

---

## 7. DvP Settlement

### 7.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| S-P-01 | Create settlement | Fill seller, buyer, token amount, cash amount, deadline → Create | Tx succeeds, settlement appears in list with status "Pending" | Critical | | |
| S-P-02 | Execute settlement | Click "Execute" on pending settlement | Tx succeeds, status changes to "Settled", green status: "✓ Settlement #N executed — DvP atomic swap complete" | Critical | | |
| S-P-03 | Cancel settlement | Click "Cancel" on pending settlement | Tx succeeds, status changes to "Cancelled" | High | | |
| S-P-04 | Batch execute | Select multiple pending → "Batch Execute" | All selected settlements executed, status message: "✓ Batch execute complete — N settlement(s) processed" | High | | |
| S-P-05 | Select-all checkbox | Click select-all → "Batch Execute" | All pending settlements selected and executed | Medium | | |
| S-P-06 | Settlement status color | View settlement list | Pending = yellow, Settled = green, Failed = red, Cancelled = gray | Low | | |
| S-P-07 | Default deadline | Leave deadline as default (24 hours) | Settlement created with 24-hour deadline | Medium | | |
| S-P-08 | Custom deadline | Enter 48 hours → Create | Deadline set to 48 hours from now | Medium | | |
| S-P-09 | Settlement list display | Create multiple settlements | All settlements shown with correct ID, seller, buyer, amounts, status | Medium | | |
| S-P-10 | Operator creates settlement | Connect as operator → create settlement | Tx succeeds (Operator has OPERATOR_ROLE on DvP), settlement appears | Critical | | |

### 7.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| S-N-01 | Missing seller address | Leave seller empty → Create | Button disabled or validation error | Medium | | |
| S-N-02 | Missing buyer address | Leave buyer empty → Create | Button disabled or validation error | Medium | | |
| S-N-03 | Zero token amount | Enter 0 tokens → Create | Validation error or button disabled | Medium | | |
| S-N-04 | Zero cash amount | Enter 0 cash → Create | Validation error or button disabled | Medium | | |
| S-N-05 | Execute expired settlement | Wait past deadline → Execute | Tx reverts, error about expired deadline | Critical | | |
| S-N-06 | Execute already settled | Settlement status "Settled" → click Execute | Execute button not shown for settled items | High | | |
| S-N-07 | Cancel non-pending settlement | Settlement already settled → Cancel | Cancel button not shown for settled items | Medium | | |
| S-N-08 | Execute without approvals | Seller/buyer haven't approved tokens → Execute | Tx reverts, error about insufficient allowance | Critical | | |
| S-N-09 | Invalid seller address | Enter "invalid" → Create | Tx fails with address format error | Medium | | |
| S-N-10 | Batch execute empty selection | Click "Batch Execute" with none selected | Button disabled when count = 0 | Low | | |
| S-N-11 | Zero deadline | Enter 0 hours → Create | Validation error (deadline must be > 0) | Medium | | |
| S-N-12 | Execute when seller has insufficient tokens | Seller sold tokens after creation → Execute | Settlement marked as "Failed", status: "✗ Settlement #N failed: Seller has insufficient security tokens" | Critical | | |
| S-N-13 | Investor creates settlement | Connect as investor → fill form → Create | Tx reverts on-chain (no OPERATOR_ROLE), error displayed | Critical | | |
| S-N-14 | Execute when buyer has insufficient cash | Buyer spent cash after creation → Execute | Settlement marked as "Failed", status: "✗ Settlement #N failed: Buyer has insufficient cash tokens" | Critical | | |
| S-N-15 | Execute when seller is frozen (jurisdiction blocked) | Admin freezes seller address → Execute | Settlement marked as "Failed", status: "✗ Settlement #N failed: Seller address is frozen (jurisdiction or sanction)" | Critical | | |
| S-N-16 | Execute when buyer is frozen (jurisdiction blocked) | Admin freezes buyer address → Execute | Settlement marked as "Failed", status: "✗ Settlement #N failed: Buyer address is frozen (jurisdiction or sanction)" | Critical | | |
| S-N-17 | Execute when seller is under lock-up | Admin sets lock-up on seller → Execute | Settlement marked as "Failed", status: "✗ Settlement #N failed: Seller is under lock-up period" | Critical | | |
| S-N-18 | Execute when buyer is not verified | Revoke buyer's KYC claims → Execute | Settlement marked as "Failed", status: "✗ Settlement #N failed: Buyer is not registered or verified" | Critical | | |

---

## 8. Compliance Rules (Admin)

### 8.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| C-P-01 | Allow jurisdiction | Enter "HK" → Allow → Update | Jurisdiction "HK" appears with ✓ in jurisdiction list | Critical | | |
| C-P-02 | Block jurisdiction | Enter "US" → Block → Update | Jurisdiction "US" appears with ✗ in jurisdiction list | Critical | | |
| C-P-03 | Set per-investor cap | Enter address + 10000 → "Set Per-Investor Cap" | Cap set, tx succeeds, green status | High | | |
| C-P-04 | Set global cap | Enter 50000000 → "Set" | Global cap updated, card displays new value | High | | |
| C-P-05 | Set lock-up period | Enter address + future date → "Set Lock-Up" | Lock-up registered on-chain | High | | |
| C-P-06 | Country code uppercase | Enter "sg" → submit | Auto-uppercased to "SG" | Low | | |
| C-P-07 | Display current state | Open Compliance page | Oracle address, global cap, jurisdiction list loaded from events | Medium | | |
| C-P-08 | Toggle jurisdiction | Allow "JP", then Block "JP" | "JP" status changes from ✓ to ✗ | High | | |
| C-P-09 | Disable cap with zero | Set per-investor cap to 0 → submit | Cap disabled (interpreted as no cap) | Medium | | |

### 8.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| C-N-01 | Country code > 2 chars | Try entering "HKG" | Input limited to 2 characters | Low | | |
| C-N-02 | Empty country code | Leave code empty → Update | Button disabled or error | Medium | | |
| C-N-03 | Invalid investor address for cap | Enter "abc" → Set Cap | Tx fails, error about address format | Medium | | |
| C-N-04 | Negative cap amount | Enter -1000 → Set Cap | Validation error or contract rejection | Medium | | |
| C-N-05 | Lock-up date in past | Select past date → Set Lock-Up | Tx may succeed but lock-up is already expired (no practical effect) | Low | | |
| C-N-06 | Non-admin access (investor) | Connect as investor → navigate to `/compliance` | Route guard redirects to Dashboard | Critical | | |
| C-N-07 | Non-admin access (agent) | Connect as agent → navigate to `/compliance` | Route guard redirects to Dashboard (Agent has no Compliance role) | Critical | | |
| C-N-08 | Set cap for unregistered address | Enter address not in identity registry → Set Cap | Tx may revert depending on compliance logic | Medium | | |
| C-N-09 | Empty cap amount | Leave amount empty → Set Cap | Validation error or button disabled | Low | | |

---

## 9. Governance (Voting & Proposals)

### 9.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| G-P-01 | Self-delegate | Click "Self" → "Delegate" | Voting power equals token balance, delegatee = self | High | | |
| G-P-02 | Delegate to another | Enter address → "Delegate" | Voting power transferred to delegate, delegatee displays other address | High | | |
| G-P-03 | Create proposal | Enter description → "Submit Proposal" | Proposal appears in list with "Pending" state | Critical | | |
| G-P-04 | Vote For | On active proposal → click "For" | Vote recorded, For bar increases, vote count updates | Critical | | |
| G-P-05 | Vote Against | On active proposal → click "Against" | Vote recorded, Against bar increases | Critical | | |
| G-P-06 | Vote Abstain | On active proposal → click "Abstain" | Abstain count increases | High | | |
| G-P-07 | Queue succeeded proposal | Proposal state = Succeeded → click "Queue for Execution" | Proposal state changes to "Queued" | Critical | | |
| G-P-08 | Execute queued proposal | Proposal state = Queued → click "Execute" | Proposal state changes to "Executed" | Critical | | |
| G-P-09 | Expand proposal details | Click expand button on proposal | Shows proposer, snapshot block, deadline block, targets | Low | | |
| G-P-10 | Governance info display | Open Governance page | Shows governor name, voting delay/period, quorum %, threshold, timelock delay | Medium | | |
| G-P-11 | Vote percentage bars | Proposal with votes | For/Against/Abstain bars with percentage labels | Low | | |
| G-P-12 | Proposal state badges | View multiple proposals | Correct color-coded badges: Pending/Active/Defeated/Succeeded/Queued/Executed | Medium | | |

### 9.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| G-N-01 | Create proposal without description | Leave description empty → Submit | Button disabled or error | Medium | | |
| G-N-02 | Vote on non-active proposal | Proposal state = Pending → try to vote | Vote buttons not shown or disabled | High | | |
| G-N-03 | Vote twice on same proposal | Vote For, then try to vote Against | Second vote tx reverts, error: "already voted" | Critical | | |
| G-N-04 | Create proposal without voting power | No tokens, no delegation → Submit Proposal | Tx reverts if below `proposalThreshold` | High | | |
| G-N-05 | Queue non-succeeded proposal | Proposal state = Active → try to Queue | Queue button not shown for active proposals | Medium | | |
| G-N-06 | Execute non-queued proposal | Proposal state = Succeeded (not queued) → Execute | Execute button not shown | Medium | | |
| G-N-07 | Delegate to invalid address | Enter "not-an-address" → Delegate | Error displayed, delegation not executed | Medium | | |
| G-N-08 | Empty delegate address | Leave empty → Delegate | Uses self-delegation or error | Low | | |
| G-N-09 | No voting power display | Wallet has tokens but not delegated | Voting power = 0, token balance shown separately | Medium | | |
| G-N-10 | Execute before timelock | Queue proposal → immediately Execute | Tx reverts, must wait for timelock delay | Critical | | |

---

## 10. Portfolio

### 10.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| P-P-01 | Display balances | Connect wallet with holdings | Security token and cash token balances shown with symbols | High | | |
| P-P-02 | Identity status display | Connect KYC-verified wallet | Registered: ✓, Verified: ✓, Frozen: No, Safe-Listed: Yes, Country: "HK" | High | | |
| P-P-03 | Claims grid | Connect wallet with all claims | All 6 claim topics show ✓ | Medium | | |
| P-P-04 | Transfer security tokens | Select "Security" → enter recipient + 10 → Transfer | Tx succeeds, balance decreases by 10, recipient receives 10 | Critical | | |
| P-P-05 | Transfer cash tokens | Select "Cash" → enter recipient + 100 → Transfer | Tx succeeds, THKD balance decreases, recipient receives | Critical | | |
| P-P-06 | Transfer zero balance display | Wallet with zero tokens | "0" displayed, transfer still possible if amount is available after mint | Low | | |

### 10.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| P-N-01 | Transfer more than balance | Balance = 10 → transfer 100 | Tx reverts, error about insufficient balance | Critical | | |
| P-N-02 | Transfer to invalid address | Enter "xyz" → Transfer | Error about invalid address | Medium | | |
| P-N-03 | Transfer zero amount | Enter 0 → Transfer | Tx reverts or validation error | Medium | | |
| P-N-04 | Transfer to self | Enter own address → Transfer | May succeed (no contractual restriction), balance unchanged | Low | | |
| P-N-05 | Transfer while frozen | Account frozen → try transfer | Tx reverts, error about frozen account | Critical | | |
| P-N-06 | Transfer without KYC | Non-KYC sender → transfer | Tx reverts due to compliance check | Critical | | |
| P-N-07 | Negative amount | Enter -10 → Transfer | parseUnits fails or validation error | Medium | | |
| P-N-08 | No wallet connected | Open Portfolio without connecting | Data not loaded, connection banner shown | High | | |
| P-N-09 | Transfer to non-KYC recipient | Recipient not registered → Transfer | Tx may revert depending on compliance module | High | | |
| P-N-10 | Identity — not registered | Connect brand new wallet | Registered: ✗, Verified: ✗, all claims: ✗ | Medium | | |

---

## 11. Market Management (Admin)

### 11.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| MM-P-01 | Create market | Select token → auto-fill name/symbol/decimals → Create | Tx succeeds, market appears in list with OrderBook address | Critical | | |
| MM-P-02 | Auto-detect decimals | Select token with 18 decimals | Decimals field auto-populated with 18 | Low | | |
| MM-P-03 | Auto-fill market name | Select "BAT" token | Name auto-fills "BAT / HKD", symbol auto-fills "BAT" | Low | | |
| MM-P-04 | Deactivate market | Click "Deactivate" on active market | Status changes to "INACTIVE" (red badge) | High | | |
| MM-P-05 | Reactivate market | Click "Reactivate" on inactive market | Status changes to "ACTIVE" (green badge) | High | | |
| MM-P-06 | Multiple markets | Create market for Token A, then Token B | Both appear in markets list | Medium | | |
| MM-P-07 | Filter available tokens | Token A has market, Token B doesn't | Dropdown only shows Token B (no duplicate markets) | Medium | | |

### 11.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| MM-N-01 | Duplicate market for same token | Token already has market → try to create another | Error: "A market already exists for this token" | High | | |
| MM-N-02 | No wallet connected | Open Market Management → try Create | Error: "Connect admin wallet first" | Medium | | |
| MM-N-03 | No token selected | Don't select token → click Create | Error: "Select a token" | Medium | | |
| MM-N-04 | Empty name | Clear auto-filled name → Create | Error: "Name and symbol required" | Medium | | |
| MM-N-05 | Empty symbol | Clear auto-filled symbol → Create | Error: "Name and symbol required" | Medium | | |
| MM-N-06 | Non-admin access (investor) | Connect as investor → navigate to `/markets` | Route guard redirects to Dashboard | Critical | | |
| MM-N-07 | Non-admin access (agent) | Connect as agent → navigate to `/markets` | Route guard redirects to Dashboard (Agent has no OrderBookFactory role) | Critical | | |
| MM-N-08 | No tokens available | No factory tokens exist | Dropdown empty, creation not possible | Low | | |
| MM-N-09 | Invalid decimals | Enter 99 for decimals | Contract may reject (0-18 valid range) | Low | | |

---

## 12. Wallet Custody (Admin — 98/2 Rule)

### 12.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| WC-P-01 | Register hot wallet | Enter address → tier "Hot" → label → Register | Wallet appears in table with 🔥 Hot tier | High | | |
| WC-P-02 | Register warm wallet | Enter address → tier "Warm" → Register | Wallet appears with 🌡️ Warm tier | High | | |
| WC-P-03 | Register cold wallet | Enter address → tier "Cold" → Register | Wallet appears with ❄️ Cold tier | High | | |
| WC-P-04 | Tier breakdown display | Multiple wallets registered | Hot/Warm/Cold balance cards show correct balances and % of AUM | High | | |
| WC-P-05 | Compliance check — compliant | Hot wallet < 2% of AUM | Compliance card shows "COMPLIANT" (green) | Critical | | |
| WC-P-06 | Trigger sweep check | Hot wallet over cap → "Trigger Sweep Check" | Sweep recorded, appears in audit trail | Critical | | |
| WC-P-07 | Multi-sig signers display | Open Custody page | Lists 3 authorized signers for warm wallet | Medium | | |
| WC-P-08 | Multi-sig transactions | View recent transactions | Shows ID, To, Amount, Reason, Confirmations, Status | Medium | | |
| WC-P-09 | Sweep audit trail | After sweep → check table | Shows time, from, to, amount, reason | High | | |
| WC-P-10 | Refresh data | Click refresh button | All data (breakdown, wallets, txs, sweeps) reloaded | Low | | |
| WC-P-11 | Submit multi-sig transaction | Enter token, to, amount, reason → "Propose" | Tx proposed, appears with 0/N confirmations | Critical | | |
| WC-P-12 | Confirm multi-sig transaction | Click "Confirm" on pending tx | Confirmation count increments | Critical | | |
| WC-P-13 | Execute multi-sig transaction | Tx has enough confirmations → "Execute" | Tx executed, tokens transferred from warm wallet | Critical | | |
| WC-P-14 | Cancel multi-sig transaction | Click "Cancel" on unexecuted tx | Tx marked as cancelled | High | | |

### 12.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| WC-N-01 | Compliance violation | Hot wallet holds > 2% of AUM | "OVER CAP" red warning displayed | Critical | | |
| WC-N-02 | Register invalid address | Enter "bad-address" → Register | Error displayed, wallet not registered | Medium | | |
| WC-N-03 | Register duplicate wallet | Register same address twice | Tx reverts, error about duplicate | High | | |
| WC-N-04 | Non-admin access (investor) | Connect as investor → navigate to `/custody` | Route guard redirects to Dashboard | Critical | | |
| WC-N-05 | Non-admin access (agent) | Connect as agent → navigate to `/custody` | Route guard redirects to Dashboard (Agent has no WalletRegistry role) | Critical | | |
| WC-N-06 | Empty label | Leave label empty → Register | Default label assigned (e.g., "Account 1") | Low | | |
| WC-N-07 | No wallets registered | Open page with empty registry | Empty table, zero balances, 0% for all tiers | Medium | | |
| WC-N-08 | Sweep check when compliant | Hot wallet < 2% → Trigger Sweep | Button may be hidden when compliant | Low | | |
| WC-N-09 | Invalid tier selection | Manipulate form to submit invalid tier | Contract rejects, error displayed | Medium | | |

---

## 13. Oracle Committee (Admin)

### 13.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| OC-P-01 | Display oracle members | Open Oracle Committee page (admin) | Lists all oracle member addresses with index numbers | High | | |
| OC-P-02 | Display threshold | Open page | Shows current threshold (e.g. "2-of-3") in summary card | High | | |
| OC-P-03 | Display security level | Open page | "Multi-Sig" shown when threshold ≥ 2 | Medium | | |
| OC-P-04 | Add oracle member | Enter valid address → "Add Oracle" | Tx succeeds, member appears in list, count increments | Critical | | |
| OC-P-05 | Remove oracle member | Click trash icon on member row | Tx succeeds, member removed, count decrements | Critical | | |
| OC-P-06 | Set threshold | Enter new threshold (e.g. 3) → "Update Threshold" | Tx succeeds, threshold card updates to "3-of-N" | Critical | | |
| OC-P-07 | Max oracles display | Page shows "N / 5" member count | Max oracles (5) displayed in summary card | Low | | |
| OC-P-08 | YOU badge on own address | Admin's address is an oracle member | "YOU" badge shown next to that entry | Low | | |
| OC-P-09 | Refresh oracle data | Click refresh button | Member list and threshold reload from chain | Low | | |
| OC-P-10 | Successful status banner | Add oracle → check banner | Green success banner with address shown | Low | | |

### 13.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| OC-N-01 | Add duplicate oracle | Add address that is already an oracle | Tx reverts, error: "already oracle" | High | | |
| OC-N-02 | Add when at max capacity | 5 oracles exist → try to add 6th | Button disabled or error: "max oracles" | Medium | | |
| OC-N-03 | Remove below threshold | threshold=2, 2 members → remove one | Error: "Cannot remove: would go below threshold" | Critical | | |
| OC-N-04 | Add zero address | Enter `0x0000…0000` → Add | Tx reverts, error: "zero address" | Medium | | |
| OC-N-05 | Set threshold below 2 | Enter 1 → Update Threshold | Tx reverts, error: "threshold must be >=2" | Critical | | |
| OC-N-06 | Set threshold above member count | 3 members → set threshold to 4 | Tx reverts, error: "threshold > members" | High | | |
| OC-N-07 | Non-privileged access | Connect as investor → navigate to `/oracle` | Route guard redirects to Dashboard (investor has no oracle membership) | Critical | | |
| OC-N-08 | Invalid address format | Enter "abc123" → Add Oracle | Tx fails with address format error | Medium | | |
| OC-N-09 | Empty address | Leave address empty → click Add Oracle | Button disabled (required field) | Low | | |
| OC-N-10 | Transaction rejected by user | Start add oracle → reject in MetaMask | Error displayed, form preserved | Medium | | |

---

## 14. Token Factory V2 — Upgradeable Proxies (Admin)

### 14.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| V2-P-01 | Switch to V2 tab | Open Token Management → click "V2 — Upgradeable Proxies" | V2 tab active, V2 create form and token list displayed | Medium | | |
| V2-P-02 | Display current implementation | Open V2 tab | Shows current implementation address | Medium | | |
| V2-P-03 | Create V2 token | Enter name + symbol → "Create Upgradeable Token" | Tx succeeds, proxy address shown in success banner, "UPGRADEABLE" badge in list | Critical | | |
| V2-P-04 | V2 token list | Create 2 V2 tokens | Both appear with name, symbol, proxy address, supply, "UPGRADEABLE" badge | Medium | | |
| V2-P-05 | Copy V2 proxy address | Click copy button on V2 token row | Proxy address copied to clipboard | Low | | |
| V2-P-06 | Deactivate V2 token | Click "Deactivate" on active V2 token | Status changes to "INACTIVE" (red) | High | | |
| V2-P-07 | Reactivate V2 token | Click "Reactivate" on inactive V2 token | Status changes to "ACTIVE" (green) | High | | |
| V2-P-08 | Upgrade implementation | Enter new implementation address → "Upgrade Implementation" | All V2 tokens upgraded atomically, success banner shown | Critical | | |
| V2-P-09 | Symbol auto-uppercase | Enter "bat" as symbol | Auto-uppercased to "BAT" | Low | | |
| V2-P-10 | Token count display | Multiple V2 tokens exist | "N tokens" count shown in list header | Low | | |

### 14.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| V2-N-01 | Duplicate symbol | Create "BAT" V2 token, then try "BAT" again | Error: "Symbol already exists" | High | | |
| V2-N-02 | Empty name or symbol | Leave name empty → Create | Error: "Token name and symbol cannot be empty" or button disabled | Medium | | |
| V2-N-03 | Upgrade to zero address | Enter `0x0000…0000` → Upgrade | Tx reverts, error: "zero impl" | Critical | | |
| V2-N-04 | Upgrade to same implementation | Enter current impl address → Upgrade | Tx reverts, error: "same impl" | High | | |
| V2-N-05 | Upgrade without UPGRADER_ROLE | Connect non-admin → try upgrade | Tx reverts (no role), error displayed | Critical | | |
| V2-N-06 | Non-admin create V2 token (investor) | Connect as investor → try create | Route guard blocks access to page | Critical | | |
| V2-N-07 | Non-admin create V2 token (agent) | Connect as agent → try create | Route guard blocks access (Agent has no TokenFactoryV2 role) | Critical | | |
| V2-N-08 | Symbol > 10 chars | Enter "VERYLONGSYM" (11 chars) | Input limited to 10 characters | Low | | |
| V2-N-09 | Transaction rejected by user | Start create → reject in MetaMask | Error displayed, form preserved | Medium | | |

---

## 15. Cross-Cutting / Integration Tests

### 15.1 Positive Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| X-P-01 | Full KYC → Trade flow | Register identity → Issue all claims → Verify → Place trade | Entire flow succeeds end-to-end | Critical | | |
| X-P-02 | Mint → Transfer → View Portfolio | Admin mints to investor → Investor transfers → Check portfolio | Balances update correctly across all views | Critical | | |
| X-P-03 | Create Token → Create Market → Trade | Admin creates token → creates order book → investors trade | Full market lifecycle works | Critical | | |
| X-P-04 | Settlement after trade match | Buy and sell orders match → create DvP settlement → execute | Atomic swap completes, balances correct | Critical | | |
| X-P-05 | Governance → Compliance change | Create proposal to change compliance → vote → queue → execute | Compliance change enacted via governance | High | | |
| X-P-06 | Role-based navigation (admin vs investor) | Switch between admin and investor accounts | Nav items and accessible pages change accordingly | High | | |
| X-P-07 | Role-based navigation (agent) | Connect as agent | Agent sees KYC/Mint/Oracle but NOT Compliance/Tokens/Markets/Custody; badge shows "AGENT" (orange) | High | | |
| X-P-08 | Role-based navigation (operator) | Connect as operator | Operator sees Settlement/Oracle but NOT KYC/Mint/Compliance/Tokens/Markets/Custody; badge shows "OPERATOR" (green) | High | | |
| X-P-09 | Multi-page data consistency | Mint tokens in Minting page → check Dashboard + Portfolio | Balances consistent across all pages | High | | |
| X-P-10 | V2 Token → Mint → Trade lifecycle | Create V2 token → mint via Minting → create market → trade | Full lifecycle with upgradeable token | High | | |
| X-P-11 | Oracle Committee → Compliance attestation | Configure 2-of-3 oracle → sign attestation → transfer passes compliance | Multi-oracle compliance pipeline works | High | | |

### 15.2 Negative Tests

| ID | Test Case | Steps | Expected Result | Priority | Test Result | Testing Date |
|----|-----------|-------|-----------------|----------|-------------|--------------|
| X-N-01 | Trade without KYC | Skip KYC registration → try to trade | Blocked at Trading page with KYC warning | Critical | | |
| X-N-02 | Transfer to blocked jurisdiction | Register investor in "US" (blocked) → transfer | Compliance module blocks transfer | Critical | | |
| X-N-03 | Transfer exceeding concentration cap | Set cap 100 → mint 50 → transfer 60 | Transfer reverts (recipient would exceed cap) | Critical | | |
| X-N-04 | Transfer during lock-up | Set lock-up to future → investor tries to transfer | Transfer reverts due to lock-up period | Critical | | |
| X-N-05 | Account switching data isolation | Connect Account A (has tokens) → switch to Account B (empty) | Balances, KYC status, orders all refresh to Account B's data | High | | |
| X-N-06 | Stale data after account switch | View Dashboard as admin → switch to investor | Admin health section disappears, role badge changes | Medium | | |
| X-N-07 | Network disconnect mid-operation | Start tx → disconnect network | Error displayed, state recoverable on reconnect | High | | |
| X-N-08 | Multiple rapid form submissions | Click "Mint" button rapidly 5 times | Only one tx submitted (`isSubmitting` flag prevents duplicates) | High | | |

---

## Summary Statistics

| Category | Positive | Negative | Total |
|----------|----------|----------|-------|
| 1. Wallet Connection & Network | 13 | 22 | 35 |
| 2. Dashboard | 7 | 6 | 13 |
| 3. KYC Management | 8 | 10 | 18 |
| 4. Token Management (V1) | 7 | 7 | 14 |
| 5. Token Minting | 9 | 10 | 19 |
| 6. Trading | 14 | 12 | 26 |
| 7. DvP Settlement | 10 | 13 | 23 |
| 8. Compliance Rules | 9 | 9 | 18 |
| 9. Governance | 12 | 10 | 22 |
| 10. Portfolio | 6 | 10 | 16 |
| 11. Market Management | 7 | 9 | 16 |
| 12. Wallet Custody | 14 | 9 | 23 |
| 13. Oracle Committee | 10 | 10 | 20 |
| 14. Token Factory V2 | 10 | 9 | 19 |
| 15. Cross-Cutting / Integration | 11 | 8 | 19 |
| **Total** | **147** | **154** | **301** |
