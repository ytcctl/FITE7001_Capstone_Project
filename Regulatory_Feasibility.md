Regulatory Feasibility

Key Highlights:

- Tokenized HKSTP startup equity is confirmed as **"securities"** under SFO (Cap. 571) via the SFC's "see-through" approach (Nov 2023 Circular).
- Recommended licensing: **Type 1 (Dealing in Securities)** + **Type 7 (Automated Trading Services)**; optional VATP licence under AMLO for future-proofing.
- **Settlement Finality & Custody:** Contractual finality + "rectifiable ledger" with licensed-custodian forcedTransfer() function resolves Companies (Winding Up) Ordinance (Cap. 32) s.182 risk. Strict permissioned-custody model (whitelist + custodian-managed wallets) satisfies SFC requirements.
- **KYC/AML Gateway:** API integration with licensed VATP (e.g., HashKey/OSL) for CDD, PEP/sanctions screening, and real-time monitoring (threshold > HK\$500k daily).

Legal Characterization of Tokenized HKSTP Startups

Hong Kong's existing legal and regulatory framework, primarily referring to the Securities and Futures Ordinance (Cap. 571) administered by the Securities and Futures Commission (SFC), serves as a foundation for classifying tokenized assets as "securities". The framework adequately accommodates the issuance of tokenized shares in HKSTP startups on our TokenHub platform, where shares are first issued using conventional process under Companies Ordinance then followed by tokenization of beneficial interests in the company shares. This means that tokenization is only treated as a technical representation rather than a new asset class, under the fundamental principle of "same activity, same risk, same rules".

As highlighted in the SFC tokenization circular in November 2023, the "see-through" approach views tokenized securities as traditional securities with a tokenization wrapper. This has marked a significant shift from the previous statement in March 2019, where the SFC classified security tokens as "complex products" hence they can only be offered to professional investors and the SFC required intermediaries to adopt additional investor protection measures. After taking the new approach, the offerings of tokenized securities fall within the existing framework for regulating securities, preserving the legal rights and obligations despite the securities being represented digitally on distributed ledger. Similarly, all the securities-related activities such as distribution, advising on tokenized private equity remain subject to the intermediaries' existing code of conduct.

SFC Type 1/7/VATP Licensing Strategy for TokenHub Platform

Given the clear legal characterization of tokenized HKSTP startups as "securities" under the SFC's "see-through" approach, our TokenHub platform requires SFC Type 1 regulated activity (dealing in securities) and Type 7 regulated activity (providing automated trading services) under the Securities and Futures Ordinance (Cap. 571) (SFO). Meanwhile, under the Anti-Money Laundering and Counter-Terrorist Financing Ordinance (Cap. 615) (AMLO), licensing applies to any centralised platforms providing trading services in non-security tokens. Although our platform primarily trades security tokens, the SFC strongly suggests that virtual asset trading platforms apply for licences under both the SFO and AMLO regimes, given the potential evolution of virtual asset's classification. This dual licensing approach ensures comprehensive coverage for both security-token-focused activities (e.g., issuance and secondary market trading of tokenized HKSTP shares) and any trading with virtual asset features, thereby supporting business continuity and regulatory compliance.

Regulatory Analysis on Settlement Finality and Custody Arrangements

**Settlement finality** as defined under the Clearing and Settlement System Ordinance (Cap. 584), in general term refers to "the discharge of an obligation through the transfer of funds or securities that has become irrevocable and unconditional". This regime aims to provide statutory protection of the integrity of transfer orders that settled through eligible designated clearing and settlement system (CSS) against reversal, even in insolvency. A designated CSS should fulfil the necessary statutory requirements stated in the Payment Systems and Stored Value Facilities Ordinance (Cap. 584). From the PSSVFO section 4(1), the HKMA is empowered to designate any clearing and settlement systems or retail payment systems. When these systems are in operation in Hong Kong or accepting transfer orders denominated in Hong Kong dollars, they are subject to the HKMA oversight. Furthermore, under section 55 of the PSSVFO, a certificate of finality is deemed to be issued by the CSS designated by the HKMA, ensuring legal irrevocability.

However, TokenHub is unlikely to qualify for designation as a CSS under the PSSVFO, given its private nature, limited scale, and focus on trading of tokenized private equity rather than high-volume payment or broad securities settlement systems. Without such designation, on-chain settlements cannot rely on statutory finality protections meaning that "technical finality" achieved on chain will not automatically grant "legal finality". Instead, TokenHub can achieve contractual finality through agreements embedded in platform terms, token subscription agreements, and smart contract logic. These clauses will explicitly declare on-chain transfers of tokenized beneficial interests as final, irrevocable, and unconditional upon execution, supported by legal advice confirming enforceability under Hong Kong law.

Despite contractual agreements, it is essential to address an issue when transactions incurred participant who are entering insolvency proceedings. Under Section 182 of the Companies (Winding Up and Miscellaneous Provisions) Ordinance (Cap. 32), any disposition of the property made after the commencement of the winding up shall void unless the court otherwise orders. This means that a "technical finalized" transaction could still be legally challenged or reversed by the liquidator during insolvency.

Impact on Smart Contract and Architecture Design

i. Defining the Point of Finality: The smart contract logic shall define settlement finality (or "technical finality") as the point when a transaction achieves a predefined number of block confirmations (N blocks). To ensure legal alignment, the platform's terms and conditions will state that only upon reaching N-block confirmations, the transfer of legal and beneficial interests is deemed irrevocable and legally binding between the parties.

ii. "Rectifiable Ledger" Architecture: To ensure that on-chain transactions compliant with court-ordered reversals (e.g. during insolvency proceedings), the smart contracts shall include a "forcedTransfer()" function that allows a licensed custodian to reallocate tokens in response to a valid order or liquidator's instruction. With this mechanism the on-chain records to be rectified, such that the records can synchronize with the legal finality determined by the court and remains an accurate "source of truth" to reflects the ownership of the underlying asset (i.e. tokens).

iii. Atomic Settlement - Delivery vs. Payment (DvP): To reduce settlement risks where one party failing to perform after the counterparty has settled, the platform utilizes an Atomic DvP mechanism. This mechanism ensures the tokens transfer and payment settlement occur as a single, indivisible transaction. Within the smart contracts, the assets are only transferred when the corresponding payment is verified on-chain simultaneously. If either leg is not performed, the entire transaction is reverted.

Regulatory Analysis on Custody Arrangements

Unlike purely virtual assets (like Bitcoin), tokenized HKSTP startups are legally characterized as "securities". Hence, their custody arrangements and transfer must comply with SFC's regulations. This means that TokenHub cannot simply allow participants to self-custody or transfer their tokens via unmanaged "wallet-to-wallet" approach. Instead, mirroring the traditional public equity markets (such as CCASS framework), client assets need to be held by a licensed custodian with the asset transfers being executed and recorded in centralized ledger.

This requirement brings to the consideration that smart contract design need to shift from a "wallet-to-wallet" to a "permissioned custody" model, where transfers are only executed between verified, custodian-managed wallets. Furthermore, the client tokens must be strictly segregated from the intermediary's own assets to protect investors in the event of intermediary's insolvency. It is also expected that the intermediaries maintain proper key management and tokens recovery mechanism.

Impact on Smart Contract and Architecture Design

i. "Permissioned Custody and Transfer" model: Instead of a public "transfer()" function, this model requires every transaction being pre-checked against an on-chain identity registry. The token transfer will only execute if both sender's and receiver's wallets are within whitelist and associated with verified custodians. If a participant attempts to send tokens to any self-custody wallet, the smart contract will reject such transaction.

ii. Tokens recovery mechanism: The architecture shall include a "Administrator" role held by the licensed custodian. In case an investor loses key to access to their wallet, after approved by TokenHub platform the custodian can initiate burn of the lost tokens and mint new tokens into another wallet for investor. Such technical clawback mechanism ensures that legal ownership remains despite any technical accidents.

KYC/AML Framework and Compliance Procedures Manual Development

Given that tokenized HKSTP startups are legally characterized as "securities" under the principle of "same activity, same risk, same rules", our platform's compliance manual must bridge traditional regulatory standards with the technical specificities of blockchain technology. This ensures that all activities remain subject to existing codes of conduct while addressing the unique risks of virtual assets.

**KYC/AML Framework** - Serving as the governance layer that defines our platform's legal standing and risk management strategy in accordance with the SFC guideline on AML and CFT for licensed VATPs<sup>95</sup> and the AML Ordinance (Cap. 615).

i. Risk-Based Approach (RBA): The platform adopts an RBA to identify, assess, and understand ML/TF risks. This includes categorizing participants (both startups and investors) based on factors such as country risk, entity type, and transaction patterns to determine the appropriate level of due diligence.

ii. Designated Compliance Roles: To ensure effective oversight, the platform appoints a Compliance Officer (CO) responsible for the AML/CFT system and a Money Laundering Reporting Officer (MLRO) to handle suspicious transaction reporting to the JFIU.

iii. Record-keeping Governance: In compliance with SFC guideline, all customer due diligence (CDD) data, transaction logs, digital footprint, and Travel Rule information are required to be retained for at least five years after the relationship ends.

iv. VASP Travel Rule Policy: For every virtual asset transfers including security tokens, the platform enforces the "Travel Rule"<sup><sup>[\[1\]](#footnote-1)</sup></sup> as mandated in section 12.11 of the SFC guideline. Given that our platform operates "Permissioned Custody and Transfer" model, it functions as a close-loop ecosystem where the identities of both originators and beneficiaries are pre-verified. The platform fulfils the requirement by automatically synchronizing every on-chain transaction hash with the corresponding pre-verified UBO identity data in a secure, off-chain audit trail. This ensure the required originator and beneficiary information is stored and held available for immediate regulatory inspection without exposing any personally identifiable information (PII) on the blockchain ledger.

**KYC/AML Procedures Manual Development** - Serving as the operational blueprint for our planform's participants, this manual ensures no transactions can be executed outside the supervised perimeter, eventually maintaining the integrity of the "Permissioned Custody and Transfer" model.

i. KYC/AML Procedures for HKSTP Startups (Token Issuers)

- Entity Verification & Financial Threshold: Startups must undergo full Customer Due Diligence (CDD) to verify their legal standing and incorporation under the Companies Ordinance. Our platform additionally verifies financial thresholds to ensure the startup is eligible to proceed "Tokenization Setup" phase.
- Beneficial Ownership: The manual requires the identification and verification of ultimate beneficial owners (UBOs) of the startup - typically natural persons with over 25% control. This ensures compliance with the AMLO standards and prevents the platform from being used to obscure the true controllers of the underlying legal interests being tokenized.
- Issuance Whitelisting: Once offline checks are completed, the startup's designated treasury wallet authorized and added to the on-chain identity registry. This ensures the initial "minting" and distribution of tokens are restricted to verified, custodian-managed environment, preventing any unauthorized leakage of securities.

ii. KYC/AML Procedures for Investors (Token Subscribers/Buyers)

- CDD & Enhanced Due Diligence (EDD): All investors must undergo a standard CDD process to verify identity such as UBOs, residency, etc. In line with the SFC's code of conduct for intermediaries, Enhanced Due Diligence (EDD) will be applied for high-risk profiles such as Politically Exposed Persons (PEPs).
- Digital Footprint: Investors are onboarded via SSO and MFA as the primary gate of identity. Beyond that, the platform collects digital footprint data (e.g. IP addresses, geo-location data and device identifiers, etc) as required by the SFC guidelines for VATPs.
- Source of Funds (SoF) Verification: As part of the KYC procedures, our platform verifies that all the FPS deposits originate from a bank account held in the investor's legal name. This mandatory check applies to every FPS transaction to mitigate money laundering risks. Any token settlement will only occur in participant's wallet once the SoF verification is completed.
  - Initially our platform only allow HKD transfer in "bank-to-custodian" model. But in later phases, our platform also supports transfer of eHKD, stable coins or virtual assets from other SFC-licenced VATPs subjected to the Travel Rule. Even sourced from self-custody wallet is allowed, undergoing enhanced scrutiny protocol to address high-risk inflows such as Satoshi Test, blockchain analytics for KYT (know your transaction), source of wealth (SoW) declaration and ongoing monitoring.
- Whitelisting and Wallet Attribution: The platform generates a unique wallet address for each investor that is permanently linked to their verified identity. T The smart contract logic ensures that the Licensed Custodian maintains control over the private keys, allowing only "permissioned" transfers between whitelisted addresses.

iii. On-chain Compliance Attestation Registry

- Verification Attestation: Once the compliance officer completes the offline due diligence (i.e. all necessary KYC/AML procedures), the platform issues an on-chain attestation to the Identity Registry (ONCHAINID as "Verified").
- Pre-trade Compliance & Ongoing Monitoring: The smart contract works as "automated gatekeeper" to perform a real-time compliance check against the Identity Registry before executing every trade in "Order Matching Engine". If it does not return a "verified" status, the transaction is automatically rejected.
- Revocation Logic: If an investor's status changes (e.g., they become a PEP or their ID expires), the compliance officer updates the registry offline, which immediately "de-whitelists" the wallet on-chain, freezing their ability to trade.
- Identity Re-verification for Token Recovery: In the event of any technical accidents (e.g., lost account access), upon re-verification process and compliance approval - The licensed custodian uses its "Administrator" role to burn the lost tokens and mint replacements to a new whitelisted wallet.

TokenHub Investor Portal and User Lifecycle

The TokenHub Investor Portal is designed as an intuitive and secure interface for investors to manage the full lifecycle of trading tokenized HKSTP startups. The user journey begins with digital onboarding on the portal, including KYC/AML process and source of funds (SoF) verification to meet regulatory requirements. The portal's architecture is engineered to integrate with our underlying smart contract layer, facilitating the creation of permissioned wallets and whitelisted addresses. The portal also facilitates IPO subscription of tokenized startup and secondary market trading via order book matching. The lifecycle concludes with near real-time settlement via atomic DvP mechanism, providing investors with timely transaction confirmations and portfolio management on the portal. The followings are the key features:

i. Digital Onboarding & Regulatory Verification

- Mirroring the account opening procedures in traditional securities brokage, the portal guides investors through an automated digital KYC/AML workflow, including the submission of documents for identity verification and proof of residency.
- The portal also facilitates a secure account login experience that users login via SSO (single sign-on) with MFA (multi-factor authentication).
- This initial layer serves as "gatekeeper" that only verified participants can access the tokenized ecosystem, directly addressing the SFC's requirements for client identity (KYC) and anti-money laundering controls.

ii. Source of Funds (SoF) & Account Funding

- Investors initiate funding via HKD FPS and the portal provides a clear interface to submit deposit proof. The investors can track their transfer status in real-time.
- Initially our platform only allow HKD transfer in "bank-to-custodian" model. But in later phases, our platform also supports transfer of eHKD, stable coins or virtual assets from other SFC-licenced VATPs, or even self-custody wallet.
- Further compliance procedures, portal interface and smart contract will be developed accordingly.

iii. Permissioned Wallet & Portfolio Management

- Once the KYC and SoF is verified, the smart contract automatically generates a unique wallet and whitelisted address for the investors.
- This wallet becomes visible in the portal allowing investors to view their balance and manage their portfolio.

iv. IPOs on Tokenized Startup

- The portal features a dashboard where the investors can browse the "Upcoming" and "Recently Listed" offerings. Each listing provides comprehensive details, including the legal terms of the tokenized equity, startup milestones, etc.
- Through few clicks on the interface, investors can subscribe directly after the back-end checking to ensure the investor has sufficient funding and that their permissioned wallet is active on the whitelist.
- After subscription period closed, the underlying smart contract executes the IPOs allotment via initial "minting" of tokenized startup into wallets. Investors can then check the allotment status in the portal.

v. Order Matching & Atomic DvP Settlement

- Investors can browse a real-time order book and place buy/sell orders through the portal interface.
- Once an order is matched, the investor receives a timely transaction confirmation (backed by atomic DvP settlement on smart contract) and an updated portfolio view.a

vi. Withdrawal & Account Closing

- Investors can only initiate withdrawals of their available cash balance directly to their pre-verified bank account via FPS. Any withdrawals of tokenized startups are prohibited.
- If investors decide to close their accounts, the portal provides clear guides on the process of liquidating holdings on the secondary market. Once the portfolio is cleared and the cash balance is withdrawn, the portal facilitates the formal deactivation of the digital wallet.

- The travel rule refers to the application of the wire transfer requirements set out in FATF Recommendation 16 in a modified form in the context of virtual asset transfers (in particular, the requirements to obtain, hold, and submit required and accurate originator and required recipient information immediately and securely when conducting virtual asset transfers), recognising the unique technological properties of virtual assets. [↑](#footnote-ref-1)
