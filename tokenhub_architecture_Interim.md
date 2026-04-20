**Custodial Wallet Management Architecture: Hot vs. Cold Storage Protocols**

To comply with the SFC's updated conduct standards for Virtual Asset Trading Platforms (VATPs) issued on January 16, 2025, TokenHub implements a tiered storage architecture that prioritizes the security of client assets while maintaining operational liquidity.

**The "98/2" Asset Allocation Requirement**

TokenHub adheres to the mandatory **98/2 Requirement**, ensuring that at least 98% of client virtual assets are stored in cold storage (offline), with no more than 2% held in hot storage (online) for daily transaction processing.

| **Wallet Tier** | **Connectivity** | **Storage Ratio** | **Primary Use Case**                                   | **Security Control**                                               |
| --------------- | ---------------- | ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| **Hot Wallet**  | Always Online    | < 2%              | Instant withdrawals, FPS/tokenized deposit settlement. | Real-time monitoring, IP whitelisting, HSM-protected hot keys.     |
| **Warm Wallet** | Partially Online | Transient         | Buffer for rebalancing; daily transactional sweeps.    | Multi-signature (2-of-3) requirement for manual approval of flows. |
| **Cold Wallet** | Air-Gapped       | \> 98%            | Deep storage of long-term investor holdings.           | Fully offline private keys, physically secure safe boxes in HK.    |

**Cold Storage Security Standards**

TokenHub's cold storage infrastructure incorporates rigorous safeguards to meet the SFC's Expected Standards L and M, and the CryptoCurrency Security Standard (CCSS) Level 3 benchmarks.

**1\. Hardware Security Module (HSM) Certification**

Seeds and private keys must be generated and stored within a Hardware Security Module (HSM) located physically in Hong Kong.

- **FIPS 140-2 Level 3+:** The HSM must possess a minimum certification of FIPS 140-2 Level 3, providing high resistance to physical tampering and identity-based authentication.
- **Tamper-Active Protection:** For high-value startup tokens, TokenHub utilizes Level 4 HSMs, which are "tamper-active." These devices detect mechanical, chemical, or environmental attacks (e.g., voltage/temperature fluctuations) and instantly zeroize (erase) all sensitive cryptographic parameters before compromise.
- **No Smart Contracts:** To eliminate undiscovered technical flaws and online attack surfaces, the cold wallet system is explicitly prohibited from using smart contracts for internal custody logic.

**2\. Air-Gapped Signing Workflow**

The transfer of data between the online environment and the cold vault follows a strict unidirectional air-gap protocol.

- **Step 1: Construction:** An unsigned transaction is built on a "watch-only" online terminal.
- **Step 2: Unidirectional Transfer:** The unsigned transaction is transferred to the air-gapped device via animated QR codes or a quarantined USB drive.
- **Step 3: Offline Signing:** The transaction is reviewed and signed on the air-gapped machine. The private key never leaves this isolated environment.
- **Step 4: Return & Broadcast:** The signed bundle is returned to the online terminal and broadcast to the blockchain.

**3\. Institutional Key Ceremonies and Quorum Controls**

Management of the cold storage root keys requires a formal "Key Ceremony" protocol.

- **Multi-Party Quorum:** Key generation and backup retrieval must involve at least three independent Responsible Officers or Managers-in-Charge.
- **Geographic Distribution:** Backup seeds are stored in geographically distinct, physically secure vaults within Hong Kong, protected by biometric access and 24/7 video recording.

**Separation of Duties:** Different organizational units hold different key shares to mitigate collusion risks.

**Operational Flow and Rebalancing**

The platform maintains a real-time monitoring system to enforce the 98/2 ratio.

- **Automated Sweep:** Upon receipt of client assets in hot storage, the system automatically triggers a real-time sweep to move excess funds into cold storage.
- **Withdrawal Fulfillment:** Small withdrawals are serviced instantly from hot storage. If hot storage falls below the operational buffer, assets are manually transferred from warm storage or cold storage after multiple internal approvals.

**Disruption Recovery:** TokenHub's business continuity plan ensures the restoration of the custody system within a 12-hour window following any operational failure or cyberattack.

Permissioned Custody and Transfer

Under the SFC's guidelines, tokenized assets cannot be managed through a purely "wallet-to-wallet" or self-custody approach typical of public DeFi protocols.Instead, TokenHub utilizes a "Permissioned Custody" model, mirroring the central securities depository (CSD) framework of the traditional market.

**The Permissioned Ledger State Machine**

The ledger does not allow unrestricted transfers. Every transaction is intercepted by a compliance layer that validates the identity and eligibility of both the sender and the receiver. This is implemented through the integration of the ONCHAINID identity registry, an implementation of the ERC-3643 (T-REX) standard.

| **Ledger State Component** | **Technical Implementation**      | **Regulatory Goal**                                            |
| -------------------------- | --------------------------------- | -------------------------------------------------------------- |
| **Token Contract**         | ERC-3643 (T-REX) compliant        | Standardizes transfer logic with compliance hooks.             |
| **Identity Registry**      | Mapping of addresses to ONCHAINID | Ensures all participants are KYC/AML verified.                 |
| **Compliance Contract**    | Modular Rule Sets                 | Enforces jurisdictional limits, investor caps, and lock-ups.   |
| **Claim Topics Registry**  | List of required verifications    | Specifies what "claims" (e.g., PI status) a user must possess. |

The interaction flow for a standard transfer is as follows:

- **Initiation:** A participant initiates a transfer(to, amount) call.
- **Eligibility Check:** The token contract calls the IdentityRegistry to verify if the to address is associated with a valid ONCHAINID that has passed KYC.
- **Compliance Check:** The token contract calls the Compliance contract to verify if the transaction violates any offering rules (e.g., the maximum number of holders for a private fund).
- **Balance Check:** The system verifies the sender has an "unfrozen" balance sufficient for the transfer.
- **Execution:** If all checks pass, the ledger state is updated. If not, the transaction reverts with a specific error code (e.g., ERC7943NotAllowedUser).

**Rejection of Self-Custody**

To maintain the integrity of the permissioned custody model, the smart contract explicitly rejects any transaction involving an address not managed by a verified, licensed custodian. The IdentityRegistry only whitelists addresses that have a cryptographic link to a custodian's wallet infrastructure. This ensures that the platform can always identify the ultimate beneficial owner of every token, satisfying the "know-your-client" (KYC) requirements of the SFC.

**The forcedTransfer() Function: Technical Implementation and Logic**

The forcedTransfer() function is the primary mechanism for ledger rectification. It allows a licensed custodian or a platform administrator to reallocate tokens in response to a court order, a liquidator's instruction, or a regulatory seizure. In the context of Cap. 32 Section 182, this function is the tool used to "undo" on-chain transactions that are legally void.

**Implementation Details and Authorization**

The function is modeled on the ERC-1644 (Controller Token Operation) standard, which is part of the broader ERC-1400 library.

**Function Signature:** function forcedTransfer(address \_from, address \_to, uint256 \_amount, bytes calldata \_data, bytes calldata \_operatorData) external onlyAgent returns (bool);.

**Logic Requirements:**

- **Authorization:** The function must be protected by an onlyAgent modifier. The Agent role is assigned only to the platform's licensed custodian.
- **Bypass Standard Logic:** Unlike a regular transfer(), a forcedTransfer() bypasses the canTransfer() compliance check and the need for the sender's signature. This is necessary because the sender (the insolvent party) may be uncooperative or have lost control of their keys.
- **Receiver Verification:** Crucially, the \_to address must still be a verified identity in the IdentityRegistry.<sup>25</sup> This prevents tokens from being "forced" into an unvetted or non-compliant address, maintaining the integrity of the permissioned environment.
- **Audit Trail:** The function must emit a ControllerTransfer (or ForcedTransfer) event. This event must include the address of the agent who initiated the transfer and a reference to the legal justification (the \_operatorData field).

**Metadata Schema and Legal Anchoring**

For a forcedTransfer() to be regulatory-compliant, it must be accompanied by a verifiable link to the legal authority that mandated it. The \_operatorData field is used to store a "Legal Reference ID".

This ID typically takes the form of a Content Identifier (CID) pointing to an encrypted document on the InterPlanetary File System (IPFS). This document contains the court order or the liquidator's formal request. By anchoring the CID on-chain, the platform ensures that the rectification is transparent and auditable by the SFC or HKMA during a regulatory review.

| **Field**          | **Content Type** | **Storage Location** | **Regulatory Importance**                                            |
| ------------------ | ---------------- | -------------------- | -------------------------------------------------------------------- |
| **\_from**         | Address          | On-Chain             | Identifies the party whose interest is being voided per Section 182. |
| **\_to**           | Address          | On-Chain             | Identifies the legal owner (e.g., the liquidator).                   |
| **\_amount**       | uint256          | On-Chain             | The value of the beneficial interest recovered.                      |
| **\_operatorData** | IPFS CID         | On-Chain (as bytes)  | The immutable link to the court order/legal proof.                   |
| **Actual Order**   | PDF/Text         | Off-Chain (IPFS)     | Provides the detailed narrative and authority for the action.        |

Token Contract Development

**Project Background and Technical Architecture Introduction**

Within the Hong Kong Science and Technology Parks (HKSTP) ecosystem, the TokenHub platform aims to provide digital financing solutions for over 1,000 global startups. Currently, traditional early-stage financing processes are inefficient, with fundraising cycles typically spanning three to six months, accompanied by high transaction costs and complex fund transfer procedures. To address these pain points, TokenHub proposes tokenizing startup equity using a permissioned ledger. However, within the core architectural principle of "One Token per Startup," the technical team has raised critical concerns regarding the efficiency of the resulting gas fees.

This specification report will explore how to maintain asset isolation and compliance requirements while utilizing advanced smart contract design patterns and identity management to optimize the economic efficiency of large-scale token deployment and trading. This architecture is not merely a technical wrapper for startup equity; it is a technical implementation of the "See-Through" regulatory principle articulated by the Securities and Futures Commission (SFC) in its November 2023 circular.<sup>1</sup> In this context, every token is treated as a digital representation of a traditional security, regulated under the Securities and Futures Ordinance (Cap. 571).

**ERC-3643 Technical Standard: Compliance-by-Design**

To fulfill the "One Token per Startup" logic, TokenHub selects ERC-3643 (formerly T-REX protocol) as its core standard. Compared to standard ERC-20, ERC-3643 introduces two permission layers: the first is linked to the receiver's identity and eligibility; the second is linked to issuer-defined offering rules.<sup>47</sup> This "Compliance-by-Design" philosophy allows regulatory rules to be programmed directly into the token's smart contract.

**Composition of the Smart Contract Suite**

The TokenHub smart contract suite is not a single contract but a collection of collaborative components designed to decouple identity, compliance, and asset transfer.

- **Identity Registry**: Acts as the gatekeeper for holders, mapping wallet addresses to their ONCHAINID. It executes the isVerified() function to ensure recipients hold cryptographic claims signed by trusted issuers.
- **Compliance Module**: A modular engine used to verify transfer rules, such as the 50-shareholder limit for private companies under the Hong Kong Companies Ordinance (Cap. 622).
- **Claim Topics Registry**: Defines the types of claims required for token operation (e.g., PI status, KYC status).

**Identity Registry Storage**: A key component for gas optimization, allowing different token contracts to share the same whitelist records.

**Role-Based Access Control**

TokenHub implements the OpenZeppelin AccessControl framework to enforce the principle of least privilege.

- **Issuer**: Manages startup token metadata and pauses trading.
- **Agent**: Regulated custodian responsible for forced transfers, recovery, and registry management.

**Claim Issuer**: Accredited third-party KYC providers signing eligibility claims for ONCHAINIDs.

Tokenization Design and Gas Fee Optimization

**Legal Entity Isolation and the Necessity of "One Token per Startup"**

At the legal and regulatory level, isolating the assets of each startup into their own smart contracts is not just a design choice but a core requirement for compliance. Under the Securities and Futures Ordinance, tokenized securities must ensure clearly defined interests and legal certainty for disposal. If a multi-asset pool architecture is used, there is a risk of "asset commingling," which makes it difficult to meet legal requirements for exclusivity of ownership and independence of asset liquidation.

**Analysis of Legal Characteristics and Regulatory Classification**

The Hong Kong SFC emphasizes that tokenized securities should be viewed as traditional securities with a tokenization wrapper. This means the shareholder register (Cap Table) of every startup must be independent and precise. Adopting a "One Token per Startup" model ensures the on-chain record serves as the "Single Source of Truth," directly corresponding to the statutory records of the Companies Registry.

| **Regulatory Dimension**  | **Traditional Requirement**        | **TokenHub Technical Implementation**    | **Legal/Compliance Significance**               |
| ------------------------- | ---------------------------------- | ---------------------------------------- | ----------------------------------------------- |
| **Cap Table Accuracy**    | Manual spreadsheets; error-prone   | Immutable blockchain record              | 99.9% reduction in human error                  |
| **Asset Segregation**     | Bank escrow account isolation      | Independent smart contract address space | Prevents credit risk contagion between startups |
| **Disposal Restrictions** | Court orders; manual execution     | forcedTransfer() function                | Satisfies Companies Ordinance (Cap. 32) S182    |
| **Regulatory Filing**     | Manual submission of SFC documents | Automated filing from on-chain data      | Continuous compliance and transparency          |

**Technical Optimization Strategies for Gas Efficiency**

To address the potential gas fee issues caused by the "One Token per Startup" model, this specification proposes three core optimization strategies to minimize deployment and operational costs.

**Strategy One: EIP-1167 Minimal Proxy Pattern**

On EVM-compatible networks, deploying a full ERC-3643 contract suite can consume millions of gas units. Deploying full bytecode for every startup would be a heavy financial burden. The EIP-1167 standard (also known as the Clone Pattern) provides an extremely efficient solution.

**Technical Mechanism and Gas Savings Analysis**

EIP-1167 proxy contracts contain only ~45 bytes of runtime bytecode. Their core logic uses the DELEGATECALL opcode to forward all functional calls to a pre-deployed "Master Contract". This means that while each startup has an independent contract address and storage space, they share the same logic bytecode.

| **Deployment Type**           | **Estimated Gas Consumption** | **Savings Ratio** | **Deployment Time** |
| ----------------------------- | ----------------------------- | ----------------- | ------------------- |
| **Full Contract Deployment**  | ~2,000,000+                   | Baseline          | High                |
| **EIP-1167 Clone Deployment** | ~45,000 - 65,000              | ~90%+ Savings     | Instant             |

This pattern ensures TokenHub can scale rapidly under the "One Token per Startup" architecture at low cost. Research shows that ~29.4% of proxy contracts already use EIP-1167 to reuse contract logic.

**Strategy Two: Shared Identity Registry Storage**

In a multi-token ecosystem, data redundancy is another major source of gas fees. If every startup token independently stores KYC data for its investors, an investor holding 10 different startups would have their identity information written to the blockchain 10 times.

TokenHub's architecture physically separates the "Identity Registry" from the "Identity Storage Layer". All token contracts point to a central IdentityRegistryStorage instance. This reduces redundancy and optimizes onboarding: once an investor is verified on the platform, their ONCHAINID is marked as verified in the shared storage, allowing them to purchase any startup token without additional on-chain write costs.

**Strategy Three: EIP-712 Offline Signatures and Meta-transactions**

To achieve real-time compliance checks for every trade, the architecture requires the Compliance Service to issue a one-time approval before the transaction. Executing this step entirely on-chain would double the gas for every transaction.

The solution is the EIP-712 structured data signing standard. After verifying investor suitability off-chain, the Compliance Service issues an offline cryptographic signature. The investor includes this signature when calling the transfer function. The contract then uses the built-in ecrecover opcode (consuming only ~3,000 gas) to verify the signature. This keeps complex policy determination off-chain while maintaining immutable enforcement on-chain.

Permissioned Ledger State Machine Design and Asset Disposition

Under Hong Kong's legal framework, blockchain records must synchronize with legal reality. Decentralized models cannot meet compliance requirements when company liquidation, lost keys, or court-ordered transfers occur. Therefore, TokenHub adopts a permissioned ledger model, granting regulated custodians necessary administrative powers.

**forcedTransfer() Protocol and Legal Alignment**

Under Section 182 of the Companies (Winding Up and Miscellaneous Provisions) Ordinance (Cap. 32), any disposition of property after a winding-up petition is void unless the court orders otherwise. To technically respond to this, the architecture introduces the forcedTransfer() protocol.

- **Mechanism**: Only regulated custodians holding the "Agent" role can trigger this function. It allows tokens to be moved between addresses without the holder's private key signature.
- **Data Linkage**: Every forced transfer must include an operatorData field pointing to an encrypted IPFS file containing the court order or legal authority, ensuring every administrative action is documented.
- **Rectifiable Ledger**: This design ensures the ledger is not rigid but can be "rectified" according to judicial rulings, maintaining its status as an accurate reflection of underlying asset ownership.

**Wallet Recovery Mechanism and Custody Model**

Considering institutional investor needs, TokenHub moves away from self-custody toward "Permissioned Custody". In this model:

- **Recovery Mechanism**: If an investor loses their keys, the custodian can initiate a "Burn and Re-mint" process to migrate assets to a new wallet, ensuring legal ownership is not lost due to technical accidents.
- **Asset Segregation**: The architecture technically supports the strict segregation of client tokens from platform assets, aligning with CCASS asset custody principles.

**Atomic Delivery-vs-Payment (DvP) and Settlement Mechanism**

A core value proposition of TokenHub is collapsing fundraising and fund disbursement cycles to near-instantaneous T+0 settlement. This requires the atomic exchange of tokenized assets and tokenized cash.

**Dual-Token Custody and Settlement Contract**

Settlement is executed through a neutral Settlement Contract that manages both the Asset Leg (startup equity) and the Payment Leg (tokenized cash).

| **Settlement Dimension**    | **Traditional Process**            | **TokenHub Atomic DvP**                |
| --------------------------- | ---------------------------------- | -------------------------------------- |
| **Settlement Cycle**        | T+2 or more                        | T+0 (Instant cryptographic settlement) |
| **Counterparty Risk**       | Present (Payment without delivery) | Zero (Failed trades revert entirely)   |
| **Payment Asset**           | Bank wire transfer                 | Tokenized deposits / Stablecoins       |
| **Compliance Verification** | Post-trade audit                   | Pre-trade smart contract enforcement   |

Technically, the settlement contract executes the following logic:

If any condition is not met (e.g., insufficient balance or expired KYC), the EVM reverts the entire transaction sequence, preventing partial settlement. This aligns with the HKMA "Project Ensemble" vision of "Tokenized Assets + Tokenized Money = Atomic Settlement".

**Genealogy of a Share and Forensic Analysis**

To meet rigorous audit and regulatory requirements for equity history, the TokenHub architecture features a detailed event log system. While on-chain state storage is expensive, the EVM LOG instruction provides low-cost, permanent storage.

**Event Log Design Specification**

Every equity-related operation must trigger a corresponding event to form a "Genealogy of a Share" record, essential for digital forensics and reconstructing events.

| **Event Name**        | **Indexed Parameters**   | **Stored Data**         | **Auditing Purpose**                     |
| --------------------- | ------------------------ | ----------------------- | ---------------------------------------- |
| IdentityLinked        | walletAddress, onchainID | countryCode             | Tracks wallet-to-identity mapping        |
| TransferApproved      | sender, receiver, amount | voucherID, timestamp    | Records compliance authorization history |
| ForcedAction          | operator, affectedWallet | legalReasonID, orderCID | Documents legal basis for intervention   |
| ComplianceRuleUpdated | startupID, ruleType      | oldValue, newValue      | Monitors changes in governance rules     |

Compared to modifying storage slots (~20,000 gas), emitting an indexed log costs only ~1,000 to 2,000 gas, making the "Genealogy of a Share" both economically feasible and efficient.

Settlement Token Contract

The Settlement Token Contract is the official digital record of who owns what in a startup. Because these tokens are considered "securities" under Hong Kong law (Cap. 571), they cannot be traded freely like Bitcoin.\[1, 1\] Instead, TokenHub uses the ERC-3643 (T-REX) standard. This system has built-in rules that check a person's identity before they are allowed to buy or sell any tokens.

**How Transfers are Controlled**

The contract uses several layers to make sure everyone follows the rules. It works like a standard token but adds a "gatekeeper" check to every transfer. Before a transfer happens, the contract asks the IdentityRegistry if the person is allowed to hold the shares.

The IdentityRegistry checks a person's ONCHAINID (a digital ID). It looks for digital "stamps" or claims that prove the person has passed KYC (identity check), AML (anti-money laundering check), and is a Professional Investor (PI). These checks are required by Hong Kong's licensing rules for buying and selling securities.

| **Component**            | **What it is**                           | **What it does**                                         |
| ------------------------ | ---------------------------------------- | -------------------------------------------------------- |
| Security Token Contract  | ERC-3643 / T-REX Protocol.               | The main digital ledger for shares and trades.           |
| Identity Registry        | Mapping of addresses to ONCHAINID.       | Checks if the sender and receiver are allowed to trade.  |
| Claim Topics Registry    | List of required rules (like PI or KYC). | Sets the legal requirements for owning a token.          |
| Trusted Issuers Registry | List of approved ID checkers.            | Makes sure ID info comes from trusted, licensed sources. |
| Compliance Module        | A rule-checking engine.                  | Limits the number of shareholders to 50, per local law.  |

**Fixing the Ledger and Court Orders**

In Hong Kong, the law (Cap. 32) says that if a company is closing down, a court can cancel or change share transfers. Blockchains are usually impossible to change, but TokenHub uses a "Rectifiable Ledger" to stay legal.

We use a function called forcedTransfer(), based on the EIP-1644 standard. This allows a licensed custodian to move tokens without the owner's permission if a court or liquidator orders it. To keep things transparent, the system creates a special ControllerTransfer event whenever this happens.

The code for this is: forcedTransfer(address \_from, address \_to, uint256 \_amount, bytes \_data, bytes \_operatorData). The \_operatorData part includes a link (IPFS CID) to a private, encrypted copy of the court order. This proves there was a legal reason for moving the tokens and keeps the blockchain as a reliable "source of truth."

**Managing Identity with ONCHAINID**

TokenHub uses ONCHAINID (ERC-734/735) to manage IDs without putting private personal info on the blockchain. Every investor has an identity contract that holds their verified "claims" (like being an approved investor). When a trade starts, the token contract checks the IdentityRegistry to see if the investor has the right claims.

This helps TokenHub follow the SFC's rules on technology risk and privacy. It also helps manage the 50-shareholder limit for private companies in Hong Kong. The system can count unique identities rather than just wallet addresses, ensuring that one person using two wallets is still only counted as one shareholder.

Minting/Burning Logic

Tokens representing startup shares are created (minted) or destroyed (burned) under very strict controls.\[1, 1\] Only an "Agent"-usually the licensed custodian-can perform these actions. This ensures the number of digital tokens always matches the actual number of shares the startup has issued.

**Creating New Tokens (Minting)**

When a startup first sells shares on the TokenHub portal, new tokens are minted. Before any token is created, the system uses a "CanCreate" check. This check makes sure the person receiving the tokens has passed all KYC/AML tests and that the startup isn't issuing too many shares.

| **Action**            | **When it happens**                             | **Safety Check**                                      |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| First Issuance        | When an investor buys shares and pays.          | Verifies the investor's identity and status.          |
| Dividend Reinvestment | When investors get more shares instead of cash. | Checks that the investor hasn't hit ownership limits. |
| Share Buyback         | When a startup buys its own shares back.        | Checks if the shares are still "locked" for trading.  |
| Token Recovery        | If an investor loses their digital keys.        | Burns old tokens and mints new ones to a safe wallet. |

Minting is often part of an "Atomic Settlement" (DvP). This means the shares are only minted and sent to the investor's wallet if the payment (in digital cash) is received at the exact same time. This removes the risk of one person paying and the other person not delivering, making trades instant instead of taking two days to settle.

**Recovering Lost Tokens**

Losing access to a digital wallet is a big risk in the crypto world. TokenHub solves this with a "Technical Clawback" or recovery process. If an investor loses their keys, the custodian verifies their identity offline. Once confirmed, the custodian uses their special power to burn() the tokens in the lost wallet and mint() the same amount to a new, verified wallet owned by that same person.

This ensures that losing a digital key doesn't mean losing your actual legal ownership of the company. The system uses a recoveryAddress() map to keep track of which identities belong to which wallets, making sure the total number of shares in the startup stays the same.

**Governance Voting Contract**

Voting on company decisions is a key right for shareholders. TokenHub uses a "Governor" system based on the OpenZeppelin framework, but it is modified to work with the ONCHAINID identity system. This ensures that only verified owners can vote and that the "one share, one vote" rule is followed.

**Voting Based on Identity**

Some blockchain systems are vulnerable to "flash loan" attacks, where someone borrows tokens just to win a vote and then gives them back. TokenHub stops this by using a "snapshot" and a voting delay. When a vote starts, the system takes a picture of the ledger. Your voting power is based on how many tokens you held at that exact moment.

The system also checks your identity during the vote. If your KYC (identity check) expires while a vote is happening, the smart contract will automatically stop you from voting. This also prevents people from using many fake wallets to hide how much power they have, because all wallets are linked back to one identity.

| **Voting Rule**        | **Technical Detail**     | **Purpose**                                                       |
| ---------------------- | ------------------------ | ----------------------------------------------------------------- |
| Threshold to Propose   | 1% of all tokens.        | Stops people from wasting time with useless proposals.            |
| Voting Delay           | 2 days.                  | Gives everyone time to see the proposal and prepare.              |
| Voting Time            | 7 days.                  | Gives shareholders enough time to read the details.               |
| Quorum (Min. Votes)    | 10% of all tokens.       | Makes sure decisions have enough support to be valid.             |
| Wait Period (Timelock) | 48 hours after the vote. | Lets people who disagree sell their shares before changes happen. |

**Automated Execution**

When a vote passes, the changes aren't made by a person. Instead, a TimelockController contract handles it. This contract has the power to update company rules or pay out dividends. The 48-hour wait period gives shareholders a chance to check the code before it actually runs.

For startup decisions like hiring or new funding, the system creates a clear, permanent record of who voted for what. This replaces old-fashioned board meetings and creates a "Genealogy of a Share" that auditors or the SFC can check at any time.

Deposit/Withdrawal Workflow

Moving money between a traditional bank and the TokenHub blockchain is handled by a smooth deposit and withdrawal process. The system connects the "Asset" (the startup shares) with the "Payment" (digital HK dollars) using Hong Kong's Faster Payment System (FPS) and the HKMA's "Project Ensemble" framework.

**Using FPS for Instant Deposits**

The deposit system uses Hong Kong's FPS to move money 24/7. When an investor wants to add money, the TokenHub portal gives them a unique FPS ID or a QR code. This code includes the exact amount and a reference number linked to their digital identity.

Once the investor pays through their banking app, the FPS system sends a notification to TokenHub. The TokenHub server then tells the blockchain to mint() digital cash tokens (like a stablecoin) into the investor's wallet. This makes money available for investing in seconds rather than days.

| **Step** | **Who does it**  | **Technical Action**                             |
| -------- | ---------------- | ------------------------------------------------ |
| Start    | Investor.        | Chooses amount and gets an FPS QR code.          |
| Pay      | Investor's Bank. | Sends money to TokenHub's safe account.          |
| Notify   | Payment System.  | Sends a real-time "payment successful" message.  |
| Match    | TokenHub Server. | Connects the payment to the right user identity. |
| Mint     | Cash Contract.   | Creates digital HKD for the investor to use.     |

**Safe Withdrawals**

Withdrawals must follow strict anti-money laundering (AML) laws. Before an investor can take money out, the system runs a compliance check to make sure the funds are clean.

To withdraw, the investor's digital cash tokens are burned (destroyed). Once that is done, the platform sends the real money back to the investor's bank account via FPS. This is a "Closed-Loop" system, meaning you can only withdraw money to a bank account that has already been verified as yours, preventing fraud and money laundering.

The Future: Project Ensemble

As TokenHub grows, it will move toward using "Project Ensemble," a plan by the HKMA. Instead of using FPS to create our own digital cash, we will use "tokenized deposits" issued directly by commercial banks. This will use a Wholesale Central Bank Digital Currency (wCBDC) to settle trades between banks instantly and safely.

By following Project Ensemble, TokenHub ensures its digital money is as safe as possible. This will eventually allow for "Atomic DvP" across different systems, where you could trade a share on the HKSTP ledger for money on a bank's ledger in one single, unbreakable step. This is the future of Hong Kong's secure digital economy.
