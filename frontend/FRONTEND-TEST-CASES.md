# Frontend Functional Test Cases — TokenHub HKSTP Security Token Suite

## Test Environment Prerequisites

| Item | Details |
|------|---------|
| Blockchain | Besu Devnet (Chain ID 31337) running locally or via Codespaces |
| Contracts | All contracts deployed via `npx hardhat run scripts/deploy.js --network besu` |
| Wallets | Admin wallet (deployer), Agent wallet, 2+ Investor wallets |
| Browser | MetaMask installed and configured for Besu Devnet |

---

## 1. Wallet Connection & Network (Web3Context / Layout)

### 1.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| W-P-01 | Connect via MetaMask | Click wallet menu → "MetaMask" | Wallet connects, address displayed, role badge shown, chain ID = 31337 |
| W-P-02 | Connect via test account | Click wallet menu → select pre-loaded test account | Wallet connects with test account address, correct role detected |
| W-P-03 | Connect via custom private key | Enter valid `0x` + 64 hex chars → "Connect" | Wallet connects, address derived correctly, account saved to localStorage |
| W-P-04 | Disconnect wallet | Click wallet → "Disconnect" | Address cleared, UI reverts to "Connect Wallet" state, routes unprotected |
| W-P-05 | Switch between accounts | Connect Account A → switch to Account B via wallet menu | Address updates, roles recalculated, balances refreshed |
| W-P-06 | Auto-reconnect on page reload | Connect wallet → reload page | Wallet automatically reconnects, same account restored |
| W-P-07 | Save custom account with label | Enter private key + label "Test Investor" → connect | Account appears in saved accounts list with label |
| W-P-08 | Remove saved account | Click ✕ button on saved account entry | Account removed from saved list and localStorage |
| W-P-09 | Network switch prompt | Connect on wrong network → click "Switch Network" | MetaMask prompts to add/switch to Besu Devnet (chain 31337) |
| W-P-10 | Role detection — admin | Connect with deployer key | `roles.isAdmin = true`, admin routes accessible |
| W-P-11 | Role detection — agent | Connect with agent key | `roles.isAgent = true`, admin routes accessible |
| W-P-12 | Role detection — investor | Connect with regular wallet | `roles.isAdmin = false, isAgent = false`, admin routes hidden |

### 1.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| W-N-01 | Invalid private key format | Enter "abc123" in custom key field → submit | Error: "Invalid private key format", connection not attempted |
| W-N-02 | Short private key | Enter `0x` + 60 hex chars | Error: "Invalid private key format" |
| W-N-03 | Private key with invalid chars | Enter `0x` + 64 chars including `g`, `z` | Error: "Invalid private key format" |
| W-N-04 | MetaMask not installed | Open in browser without MetaMask → click MetaMask | MetaMask option hidden or error message displayed |
| W-N-05 | User rejects MetaMask connection | Click MetaMask → reject permission request | No crash, wallet remains disconnected |
| W-N-06 | Wrong network connected | Connect MetaMask on Ethereum mainnet (chain 1) | Yellow banner: "Wrong Network" with switch button, routes accessible but data may be unavailable |
| W-N-07 | Connect with empty private key | Leave key field empty → submit | Error message or button disabled |
| W-N-08 | RPC node unreachable | Stop Besu node → attempt to connect | Graceful error, role detection defaults to no roles |
| W-N-09 | Admin route access without role | Connect as investor → navigate to `/kyc` directly via URL | Redirected to Dashboard, admin page not rendered |
| W-N-10 | Admin route access to `/mint` | Connect as investor → navigate to `/mint` via URL | Redirected to Dashboard |
| W-N-11 | Admin route access to `/compliance` | Connect as investor → navigate to `/compliance` via URL | Redirected to Dashboard |
| W-N-12 | Admin route access to `/custody` | Connect as investor → navigate to `/custody` via URL | Redirected to Dashboard |

---

## 2. Dashboard

### 2.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| D-P-01 | Display token balances | Connect wallet with token holdings | Security token balance, cash token balance, total supply displayed correctly |
| D-P-02 | KYC status — verified | Connect KYC-verified wallet | Green "Verified" badge shown |
| D-P-03 | KYC status — registered only | Connect registered but unverified wallet | "Registered" badge shown (not verified) |
| D-P-04 | KYC claims grid | Connect verified wallet with all claims | All 6 claim topics show "Active" status |
| D-P-05 | System health check (admin) | Connect admin → click "Run Health Check" | Health report shows total/passed/failed counts, individual results in grid |
| D-P-06 | Health check all passing | All contracts deployed correctly → run health check | "Healthy" status (green indicator), all checks show ✓ |
| D-P-07 | Zero balances display | Connect new wallet with no tokens | Balances show "0" or "0.0", not errors |

### 2.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| D-N-01 | No wallet connected | Open Dashboard without connecting | "Connect Wallet" banner shown, no data loaded |
| D-N-02 | KYC status — not registered | Connect wallet that was never registered | "Not Registered" status displayed |
| D-N-03 | Health check non-admin | Connect as investor | Health check section hidden or button disabled |
| D-N-04 | Health check failure | Contract address misconfigured → run health check | Red banner: "Health check failed", graceful error message |
| D-N-05 | Partial data fetch failure | One contract call fails (e.g. compliance down) | Other data still renders, failed fields show `—` placeholder |
| D-N-06 | Claims partially missing | Wallet has KYC but not Accredited claim | Partial claims: "Active" for KYC, "Missing" for Accredited |

---

## 3. KYC Management (Admin)

### 3.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| K-P-01 | Register new identity | Enter valid address + "HK" → "Register Identity" | Tx succeeds, green status: "✓ Identity registered", investor now in registry |
| K-P-02 | Issue signed ERC-735 claim | Select investor + "KYC Verified" + Signed mode → submit | Tx succeeds, claim issued with cryptographic signature, status green |
| K-P-03 | Set boolean claim | Select investor + "Accredited Investor" + Boolean mode + Set → submit | Tx succeeds, boolean claim set to true |
| K-P-04 | Revoke boolean claim | Select investor + claim topic + Boolean mode + Revoke → submit | Tx succeeds, claim revoked (set to false) |
| K-P-05 | Identity lookup — registered | Enter registered address → "Look Up" | Shows: Registered ✓, Verified status, Country, ONCHAINID, all 6 claim statuses |
| K-P-06 | Issue all 6 claim types | For each of the 6 topics, issue a claim | All 6 claims show "Active" in lookup |
| K-P-07 | Country code uppercase | Enter "hk" as country → submit | Auto-uppercased to "HK" before submission |
| K-P-08 | Multiple registrations | Register Address A, then Address B | Both succeed, both appear in registry |

### 3.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| K-N-01 | Register duplicate identity | Register same address twice | Tx reverts, error message displayed (e.g., "already registered") |
| K-N-02 | Invalid investor address | Enter "not-an-address" → Register | Tx fails, error message shown |
| K-N-03 | Empty address field | Leave address empty → click Register | Button disabled or error message |
| K-N-04 | Claim on unregistered investor | Issue claim for address not in registry | Error: "Investor has no ONCHAINID contract. Register first." |
| K-N-05 | Signed claim but no ONCHAINID | Select signed mode for investor without ONCHAINID | Error message about missing identity contract |
| K-N-06 | Lookup non-existent address | Enter unregistered address → Look Up | Shows: Not Registered, all claims "Missing" |
| K-N-07 | Country code > 2 chars | Enter "HKG" as country code | Input limited to 2 chars, only "HK" accepted |
| K-N-08 | Non-admin access | Connect as investor → navigate to KYC page | Route guard redirects to Dashboard |
| K-N-09 | Register with zero address | Enter `0x0000...0000` as investor address | Contract rejects, error displayed |
| K-N-10 | Transaction rejected by user | Start registration → reject in MetaMask | Error displayed, form state preserved for retry |

---

## 4. Token Management (Admin)

### 4.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| T-P-01 | Create new token | Enter "BioTech Alpha Token" + "BAT" → Create | Tx succeeds, shows new token address from `TokenCreated` event |
| T-P-02 | Token symbol auto-uppercase | Enter "bat" as symbol | Automatically uppercased to "BAT" |
| T-P-03 | Token list refresh | Create token → check token list | New token appears with name, symbol, address, supply = 0 |
| T-P-04 | Copy token address | Click copy button on token row | Address copied to clipboard |
| T-P-05 | Deactivate token | Click "Deactivate" on active token | Token status changes to inactive |
| T-P-06 | Reactivate token | Click "Reactivate" on deactivated token | Token status changes back to active |
| T-P-07 | Multiple tokens | Create 3 different tokens | All 3 appear in token list with correct data |

### 4.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| T-N-01 | Duplicate token symbol | Create token "BAT", then create another "BAT" | Error: "Symbol `BAT` already exists. Choose a different symbol." |
| T-N-02 | Empty token name | Leave name empty → Create | Error: "Token name and symbol cannot be empty." or button disabled |
| T-N-03 | Empty token symbol | Leave symbol empty → Create | Error or button disabled |
| T-N-04 | Symbol > 10 characters | Enter "VERYLONGSYMBOL" (14 chars) | Input limited to 10 chars |
| T-N-05 | Non-admin create token | Connect as investor → try to create token | Route guard blocks access |
| T-N-06 | Transaction failure | Create token with contract error → check UI | Error message displayed, form state preserved |

---

## 5. Token Minting (Admin)

### 5.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| M-P-01 | Mint security tokens | Select token → enter recipient + amount → Mint | Tx succeeds, recipient balance increases, total supply updates |
| M-P-02 | Burn security tokens | Enter holder address + amount → Burn | Tx succeeds, holder balance decreases, total supply decreases |
| M-P-03 | Mint cash tokens | Enter recipient + amount → Mint Cash | Tx succeeds, recipient receives THKD tokens |
| M-P-04 | Burn cash tokens | Enter holder address + amount → Burn Cash | Tx succeeds, cash token burned |
| M-P-05 | Set max supply cap | Enter 1000000 → "Set Cap" | Cap set, displayed in UI as current max supply |
| M-P-06 | Set mint threshold | Enter 100000 → "Set Threshold" | Threshold set, displayed in UI |
| M-P-07 | Switch between tokens | Select different token from dropdown | Token info refreshes: name, symbol, supply, cap, threshold |
| M-P-08 | Set unlimited supply | Enter 0 for max supply → "Set Cap" | Cap interpreted as unlimited |
| M-P-09 | Mint to multiple recipients | Mint 100 to Address A, then 200 to Address B | Both receive correct amounts, supply reflects total |

### 5.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| M-N-01 | Mint exceeding max supply | Set cap to 1000 → try to mint 1001 | Tx reverts, error message about exceeding cap |
| M-N-02 | Burn more than balance | Holder has 100 → try to burn 200 | Tx reverts, error about insufficient balance |
| M-N-03 | Mint to invalid address | Enter "xyz" as recipient → Mint | Error about invalid address format |
| M-N-04 | Mint zero amount | Enter 0 tokens → Mint | Tx reverts or validation error |
| M-N-05 | Negative amount | Enter -100 → Mint | Input validation rejects or parseUnits fails |
| M-N-06 | Non-numeric amount | Enter "abc" → Mint | parseUnits fails, error displayed |
| M-N-07 | Mint without admin role | Connect as investor → attempt mint | No access to page (route guard) |
| M-N-08 | Set cap below current supply | Supply is 500 → try to set cap to 100 | Tx reverts, error about cap below supply |
| M-N-09 | Mint to non-KYC address | Mint to unregistered address | Tx may revert depending on compliance module |
| M-N-10 | No token selected | Don't select token → try mint | Button disabled or error message |

---

## 6. Trading (Order Book)

### 6.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TR-P-01 | Select market | Open Trading → select market from dropdown | Market loads: order book, stats, balance display |
| TR-P-02 | Place buy order | Select Buy → enter price 10, qty 5 → submit | Tx succeeds (after cash approval), order appears in "My Orders" as Open |
| TR-P-03 | Place sell order | Select Sell → enter price 10, qty 5 → submit | Tx succeeds (after token approval), order appears in "My Orders" as Open |
| TR-P-04 | Order auto-match | Place buy at 10, then sell at 10 (different wallets) | Trade executes, appears in "Recent Trades" |
| TR-P-05 | Cancel open order | Place order → click Cancel on "My Orders" row | Order status changes to Cancelled |
| TR-P-06 | Order book display | Place multiple buy/sell orders at different prices | Bid orders (descending), Ask orders (ascending), Spread shown between them |
| TR-P-07 | Estimated total calculation | Enter price 10, qty 5 | "Estimated Total: 50 HKD" displayed |
| TR-P-08 | Cash approval for buy | Buy order with insufficient allowance | MetaMask prompts for approval, then order placed |
| TR-P-09 | Token approval for sell | Sell order with insufficient allowance | MetaMask prompts for approval, then order placed |
| TR-P-10 | Auto-refresh data | Wait 5+ seconds after placing order | Order book, trades, stats refresh automatically |
| TR-P-11 | Partial fill display | Order partially matched | "My Orders" shows filled qty < total qty, status "PartiallyFilled" |
| TR-P-12 | Recent trades time format | Trade executed 5 minutes ago | Shows "5m ago" in relative time |
| TR-P-13 | 24h price change | Multiple trades over 24h period | Daily change percentage calculated and displayed |
| TR-P-14 | Balance display | Connect wallet with holdings | Security token balance and cash balance shown above form |

### 6.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| TR-N-01 | Trade without KYC | Connect non-KYC wallet → try to place order | Red banner: "Your wallet has not passed KYC verification...", form submission blocked |
| TR-N-02 | Buy with zero price | Enter price = 0 → submit | Validation error, order not submitted |
| TR-N-03 | Sell with zero quantity | Enter quantity = 0 → submit | Validation error, order not submitted |
| TR-N-04 | Sell more than balance | Hold 10 tokens → try to sell 100 | Tx reverts, error about insufficient balance |
| TR-N-05 | Buy without cash balance | Cash balance = 0 → try to buy | Approval or order tx reverts |
| TR-N-06 | Cancel filled order | Order fully filled → try cancel | Cancel button not shown for "Filled" orders |
| TR-N-07 | Cancel already cancelled order | Order cancelled → try cancel again | Cancel button not shown for "Cancelled" orders |
| TR-N-08 | No markets available | No order books created → open Trading | Empty market dropdown, message "No markets available" |
| TR-N-09 | KYC checking state | Fresh load, KYC check in progress | Loading indicator shown, form disabled until check completes |
| TR-N-10 | Negative price input | Enter -5 as price | Validation rejects or parseUnits fails |
| TR-N-11 | Very large order | Place order for 10^18 tokens | Tx reverts (exceeds supply), error handled gracefully |
| TR-N-12 | Approve rejected by user | Approval MetaMask popup → user rejects | Error shown, order not placed, state preserved for retry |

---

## 7. DvP Settlement

### 7.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| S-P-01 | Create settlement | Fill seller, buyer, token amount, cash amount, deadline → Create | Tx succeeds, settlement appears in list with status "Pending" |
| S-P-02 | Execute settlement | Click "Execute" on pending settlement | Tx succeeds, status changes to "Settled", green status: "✓ Settlement #N executed — DvP atomic swap complete" |
| S-P-03 | Cancel settlement | Click "Cancel" on pending settlement | Tx succeeds, status changes to "Cancelled" |
| S-P-04 | Batch execute | Select multiple pending → "Batch Execute" | All selected settlements executed, status message: "✓ Batch execute complete — N settlement(s) processed" |
| S-P-05 | Select-all checkbox | Click select-all → "Batch Execute" | All pending settlements selected and executed |
| S-P-06 | Settlement status color | View settlement list | Pending = yellow, Settled = green, Failed = red, Cancelled = gray |
| S-P-07 | Default deadline | Leave deadline as default (24 hours) | Settlement created with 24-hour deadline |
| S-P-08 | Custom deadline | Enter 48 hours → Create | Deadline set to 48 hours from now |
| S-P-09 | Settlement list display | Create multiple settlements | All settlements shown with correct ID, seller, buyer, amounts, status |

### 7.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| S-N-01 | Missing seller address | Leave seller empty → Create | Button disabled or validation error |
| S-N-02 | Missing buyer address | Leave buyer empty → Create | Button disabled or validation error |
| S-N-03 | Zero token amount | Enter 0 tokens → Create | Validation error or button disabled |
| S-N-04 | Zero cash amount | Enter 0 cash → Create | Validation error or button disabled |
| S-N-05 | Execute expired settlement | Wait past deadline → Execute | Tx reverts, error about expired deadline |
| S-N-06 | Execute already settled | Settlement status "Settled" → click Execute | Execute button not shown for settled items |
| S-N-07 | Cancel non-pending settlement | Settlement already settled → Cancel | Cancel button not shown for settled items |
| S-N-08 | Execute without approvals | Seller/buyer haven't approved tokens → Execute | Tx reverts, error about insufficient allowance |
| S-N-09 | Invalid seller address | Enter "invalid" → Create | Tx fails with address format error |
| S-N-10 | Batch execute empty selection | Click "Batch Execute" with none selected | Button disabled when count = 0 |
| S-N-11 | Zero deadline | Enter 0 hours → Create | Validation error (deadline must be > 0) |
| S-N-12 | Execute when seller has insufficient tokens | Seller sold tokens after creation → Execute | Tx reverts, error about insufficient balance |

---

## 8. Compliance Rules (Admin)

### 8.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| C-P-01 | Allow jurisdiction | Enter "HK" → Allow → Update | Jurisdiction "HK" appears with ✓ in jurisdiction list |
| C-P-02 | Block jurisdiction | Enter "US" → Block → Update | Jurisdiction "US" appears with ✗ in jurisdiction list |
| C-P-03 | Set per-investor cap | Enter address + 10000 → "Set Per-Investor Cap" | Cap set, tx succeeds, green status |
| C-P-04 | Set global cap | Enter 50000000 → "Set" | Global cap updated, card displays new value |
| C-P-05 | Set lock-up period | Enter address + future date → "Set Lock-Up" | Lock-up registered on-chain |
| C-P-06 | Country code uppercase | Enter "sg" → submit | Auto-uppercased to "SG" |
| C-P-07 | Display current state | Open Compliance page | Oracle address, global cap, jurisdiction list loaded from events |
| C-P-08 | Toggle jurisdiction | Allow "JP", then Block "JP" | "JP" status changes from ✓ to ✗ |
| C-P-09 | Disable cap with zero | Set per-investor cap to 0 → submit | Cap disabled (interpreted as no cap) |

### 8.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| C-N-01 | Country code > 2 chars | Try entering "HKG" | Input limited to 2 characters |
| C-N-02 | Empty country code | Leave code empty → Update | Button disabled or error |
| C-N-03 | Invalid investor address for cap | Enter "abc" → Set Cap | Tx fails, error about address format |
| C-N-04 | Negative cap amount | Enter -1000 → Set Cap | Validation error or contract rejection |
| C-N-05 | Lock-up date in past | Select past date → Set Lock-Up | Tx may succeed but lock-up is already expired (no practical effect) |
| C-N-06 | Non-admin access | Connect as investor → navigate to `/compliance` | Route guard redirects to Dashboard |
| C-N-07 | Set cap for unregistered address | Enter address not in identity registry → Set Cap | Tx may revert depending on compliance logic |
| C-N-08 | Empty cap amount | Leave amount empty → Set Cap | Validation error or button disabled |

---

## 9. Governance (Voting & Proposals)

### 9.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| G-P-01 | Self-delegate | Click "Self" → "Delegate" | Voting power equals token balance, delegatee = self |
| G-P-02 | Delegate to another | Enter address → "Delegate" | Voting power transferred to delegate, delegatee displays other address |
| G-P-03 | Create proposal | Enter description → "Submit Proposal" | Proposal appears in list with "Pending" state |
| G-P-04 | Vote For | On active proposal → click "For" | Vote recorded, For bar increases, vote count updates |
| G-P-05 | Vote Against | On active proposal → click "Against" | Vote recorded, Against bar increases |
| G-P-06 | Vote Abstain | On active proposal → click "Abstain" | Abstain count increases |
| G-P-07 | Queue succeeded proposal | Proposal state = Succeeded → click "Queue for Execution" | Proposal state changes to "Queued" |
| G-P-08 | Execute queued proposal | Proposal state = Queued → click "Execute" | Proposal state changes to "Executed" |
| G-P-09 | Expand proposal details | Click expand button on proposal | Shows proposer, snapshot block, deadline block, targets |
| G-P-10 | Governance info display | Open Governance page | Shows governor name, voting delay/period, quorum %, threshold, timelock delay |
| G-P-11 | Vote percentage bars | Proposal with votes | For/Against/Abstain bars with percentage labels |
| G-P-12 | Proposal state badges | View multiple proposals | Correct color-coded badges: Pending/Active/Defeated/Succeeded/Queued/Executed |

### 9.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| G-N-01 | Create proposal without description | Leave description empty → Submit | Button disabled or error |
| G-N-02 | Vote on non-active proposal | Proposal state = Pending → try to vote | Vote buttons not shown or disabled |
| G-N-03 | Vote twice on same proposal | Vote For, then try to vote Against | Second vote tx reverts, error: "already voted" |
| G-N-04 | Create proposal without voting power | No tokens, no delegation → Submit Proposal | Tx reverts if below `proposalThreshold` |
| G-N-05 | Queue non-succeeded proposal | Proposal state = Active → try to Queue | Queue button not shown for active proposals |
| G-N-06 | Execute non-queued proposal | Proposal state = Succeeded (not queued) → Execute | Execute button not shown |
| G-N-07 | Delegate to invalid address | Enter "not-an-address" → Delegate | Error displayed, delegation not executed |
| G-N-08 | Empty delegate address | Leave empty → Delegate | Uses self-delegation or error |
| G-N-09 | No voting power display | Wallet has tokens but not delegated | Voting power = 0, token balance shown separately |
| G-N-10 | Execute before timelock | Queue proposal → immediately Execute | Tx reverts, must wait for timelock delay |

---

## 10. Portfolio

### 10.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| P-P-01 | Display balances | Connect wallet with holdings | Security token and cash token balances shown with symbols |
| P-P-02 | Identity status display | Connect KYC-verified wallet | Registered: ✓, Verified: ✓, Frozen: No, Safe-Listed: Yes, Country: "HK" |
| P-P-03 | Claims grid | Connect wallet with all claims | All 6 claim topics show ✓ |
| P-P-04 | Transfer security tokens | Select "Security" → enter recipient + 10 → Transfer | Tx succeeds, balance decreases by 10, recipient receives 10 |
| P-P-05 | Transfer cash tokens | Select "Cash" → enter recipient + 100 → Transfer | Tx succeeds, THKD balance decreases, recipient receives |
| P-P-06 | Transfer zero balance display | Wallet with zero tokens | "0" displayed, transfer still possible if amount is available after mint |

### 10.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| P-N-01 | Transfer more than balance | Balance = 10 → transfer 100 | Tx reverts, error about insufficient balance |
| P-N-02 | Transfer to invalid address | Enter "xyz" → Transfer | Error about invalid address |
| P-N-03 | Transfer zero amount | Enter 0 → Transfer | Tx reverts or validation error |
| P-N-04 | Transfer to self | Enter own address → Transfer | May succeed (no contractual restriction), balance unchanged |
| P-N-05 | Transfer while frozen | Account frozen → try transfer | Tx reverts, error about frozen account |
| P-N-06 | Transfer without KYC | Non-KYC sender → transfer | Tx reverts due to compliance check |
| P-N-07 | Negative amount | Enter -10 → Transfer | parseUnits fails or validation error |
| P-N-08 | No wallet connected | Open Portfolio without connecting | Data not loaded, connection banner shown |
| P-N-09 | Transfer to non-KYC recipient | Recipient not registered → Transfer | Tx may revert depending on compliance module |
| P-N-10 | Identity — not registered | Connect brand new wallet | Registered: ✗, Verified: ✗, all claims: ✗ |

---

## 11. Market Management (Admin)

### 11.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| MM-P-01 | Create market | Select token → auto-fill name/symbol/decimals → Create | Tx succeeds, market appears in list with OrderBook address |
| MM-P-02 | Auto-detect decimals | Select token with 18 decimals | Decimals field auto-populated with 18 |
| MM-P-03 | Auto-fill market name | Select "BAT" token | Name auto-fills "BAT / HKD", symbol auto-fills "BAT" |
| MM-P-04 | Deactivate market | Click "Deactivate" on active market | Status changes to "INACTIVE" (red badge) |
| MM-P-05 | Reactivate market | Click "Reactivate" on inactive market | Status changes to "ACTIVE" (green badge) |
| MM-P-06 | Multiple markets | Create market for Token A, then Token B | Both appear in markets list |
| MM-P-07 | Filter available tokens | Token A has market, Token B doesn't | Dropdown only shows Token B (no duplicate markets) |

### 11.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| MM-N-01 | Duplicate market for same token | Token already has market → try to create another | Error: "A market already exists for this token" |
| MM-N-02 | No wallet connected | Open Market Management → try Create | Error: "Connect admin wallet first" |
| MM-N-03 | No token selected | Don't select token → click Create | Error: "Select a token" |
| MM-N-04 | Empty name | Clear auto-filled name → Create | Error: "Name and symbol required" |
| MM-N-05 | Empty symbol | Clear auto-filled symbol → Create | Error: "Name and symbol required" |
| MM-N-06 | Non-admin access | Connect as investor → navigate to `/markets` | Route guard redirects to Dashboard |
| MM-N-07 | No tokens available | No factory tokens exist | Dropdown empty, creation not possible |
| MM-N-08 | Invalid decimals | Enter 99 for decimals | Contract may reject (0-18 valid range) |

---

## 12. Wallet Custody (Admin — 98/2 Rule)

### 12.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| WC-P-01 | Register hot wallet | Enter address → tier "Hot" → label → Register | Wallet appears in table with 🔥 Hot tier |
| WC-P-02 | Register warm wallet | Enter address → tier "Warm" → Register | Wallet appears with 🌡️ Warm tier |
| WC-P-03 | Register cold wallet | Enter address → tier "Cold" → Register | Wallet appears with ❄️ Cold tier |
| WC-P-04 | Tier breakdown display | Multiple wallets registered | Hot/Warm/Cold balance cards show correct balances and % of AUM |
| WC-P-05 | Compliance check — compliant | Hot wallet < 2% of AUM | Compliance card shows "COMPLIANT" (green) |
| WC-P-06 | Trigger sweep check | Hot wallet over cap → "Trigger Sweep Check" | Sweep recorded, appears in audit trail |
| WC-P-07 | Multi-sig signers display | Open Custody page | Lists 3 authorized signers for warm wallet |
| WC-P-08 | Multi-sig transactions | View recent transactions | Shows ID, To, Amount, Reason, Confirmations, Status |
| WC-P-09 | Sweep audit trail | After sweep → check table | Shows time, from, to, amount, reason |
| WC-P-10 | Refresh data | Click refresh button | All data (breakdown, wallets, txs, sweeps) reloaded |

### 12.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| WC-N-01 | Compliance violation | Hot wallet holds > 2% of AUM | "OVER CAP" red warning displayed |
| WC-N-02 | Register invalid address | Enter "bad-address" → Register | Error displayed, wallet not registered |
| WC-N-03 | Register duplicate wallet | Register same address twice | Tx reverts, error about duplicate |
| WC-N-04 | Non-admin access | Connect as investor → navigate to `/custody` | Route guard redirects to Dashboard |
| WC-N-05 | Empty label | Leave label empty → Register | Default label assigned (e.g., "Account 1") |
| WC-N-06 | No wallets registered | Open page with empty registry | Empty table, zero balances, 0% for all tiers |
| WC-N-07 | Sweep check when compliant | Hot wallet < 2% → Trigger Sweep | Button may be hidden when compliant |
| WC-N-08 | Invalid tier selection | Manipulate form to submit invalid tier | Contract rejects, error displayed |

---

## 13. Cross-Cutting / Integration Tests

### 13.1 Positive Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| X-P-01 | Full KYC → Trade flow | Register identity → Issue all claims → Verify → Place trade | Entire flow succeeds end-to-end |
| X-P-02 | Mint → Transfer → View Portfolio | Admin mints to investor → Investor transfers → Check portfolio | Balances update correctly across all views |
| X-P-03 | Create Token → Create Market → Trade | Admin creates token → creates order book → investors trade | Full market lifecycle works |
| X-P-04 | Settlement after trade match | Buy and sell orders match → create DvP settlement → execute | Atomic swap completes, balances correct |
| X-P-05 | Governance → Compliance change | Create proposal to change compliance → vote → queue → execute | Compliance change enacted via governance |
| X-P-06 | Role-based navigation | Switch between admin and investor accounts | Nav items and accessible pages change accordingly |
| X-P-07 | Multi-page data consistency | Mint tokens in Minting page → check Dashboard + Portfolio | Balances consistent across all pages |

### 13.2 Negative Tests

| ID | Test Case | Steps | Expected Result |
|----|-----------|-------|-----------------|
| X-N-01 | Trade without KYC | Skip KYC registration → try to trade | Blocked at Trading page with KYC warning |
| X-N-02 | Transfer to blocked jurisdiction | Register investor in "US" (blocked) → transfer | Compliance module blocks transfer |
| X-N-03 | Transfer exceeding concentration cap | Set cap 100 → mint 50 → transfer 60 | Transfer reverts (recipient would exceed cap) |
| X-N-04 | Transfer during lock-up | Set lock-up to future → investor tries to transfer | Transfer reverts due to lock-up period |
| X-N-05 | Account switching data isolation | Connect Account A (has tokens) → switch to Account B (empty) | Balances, KYC status, orders all refresh to Account B's data |
| X-N-06 | Stale data after account switch | View Dashboard as admin → switch to investor | Admin health section disappears, role badge changes |
| X-N-07 | Network disconnect mid-operation | Start tx → disconnect network | Error displayed, state recoverable on reconnect |
| X-N-08 | Multiple rapid form submissions | Click "Mint" button rapidly 5 times | Only one tx submitted (`isSubmitting` flag prevents duplicates) |

---

## Summary Statistics

| Category | Positive | Negative | Total |
|----------|----------|----------|-------|
| 1. Wallet Connection & Network | 12 | 12 | 24 |
| 2. Dashboard | 7 | 6 | 13 |
| 3. KYC Management | 8 | 10 | 18 |
| 4. Token Management | 7 | 6 | 13 |
| 5. Token Minting | 9 | 10 | 19 |
| 6. Trading | 14 | 12 | 26 |
| 7. DvP Settlement | 9 | 12 | 21 |
| 8. Compliance Rules | 9 | 8 | 17 |
| 9. Governance | 12 | 10 | 22 |
| 10. Portfolio | 6 | 10 | 16 |
| 11. Market Management | 7 | 8 | 15 |
| 12. Wallet Custody | 10 | 8 | 18 |
| 13. Cross-Cutting / Integration | 7 | 8 | 15 |
| **Total** | **117** | **120** | **237** |
