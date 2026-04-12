// -----------------------------------------------------------------
// Contract ABIs & Addresses  —  TokenHub HKSTP Security Token Suite
// -----------------------------------------------------------------
// Addresses are populated after running `npx hardhat run scripts/deploy.js --network besu`.
// Update the values below to match your Besu deployment.
// -----------------------------------------------------------------

/** Network configuration for the Besu devnet */
export const NETWORK_CONFIG = {
  chainId: 7001,
  chainName: 'Besu Devnet',
  rpcUrl: 'http://127.0.0.1:8545',
  blockExplorer: '',
};

// -----------------------------------------------------------------
// Contract Addresses (update after deployment)
// -----------------------------------------------------------------
export const CONTRACT_ADDRESSES = {
  identityRegistry: '0x619A83c9368aDa9fFb98c3F14b662724dD19E943',
  compliance: '0x7eF84473a4E772fB6aDfA1B0C6728A3dbf268Dd7',
  securityToken: '0x6aA8b700cD034Ab4B897B59447f268b33B8cF699',
  cashToken: '0xc83003B2AD5C3EF3e93Cc3Ef0a48E84dc8DBD718',
  dvpSettlement: '0xF216B6b2D9E76F94f97bE597e2Cec81730520585',
  tokenFactory: '0x0F095aeA9540468B19829d02cC811Ebe5173D615',
  claimIssuer: '0x51D4903ef5F871273e5B4172898B18809CFd7881',
  identityFactory: '0xa2b80D63b1f72a4D26dfc33D62EbE80148Ddd326',
  timelock: '0xe52155361a36C7d445F2c6784B14Bf7A3C306e15',
  governor: '0x3b7f51aBe2E8e6Af03e1571dB791DDA7B5a68cE6',
  walletRegistry: '0xEEE98917D56774d2F1FfAfbEA2e9b04Ce8ef7a11',
  multiSigWarm: '0x47b33c2D3e928FDf2c0A82FcD7042Ae0cFd5862A',
  systemHealthCheck: '0x3415B7D5677909742C56dDADd140808Cc31Fe22c',
  orderBook: '',  // UPDATE after running deploy-orderbook.js
  orderBookFactory: '0x36A8bE2C24f812ed7a95f14ffEBDB5F778F61699',
};

// -----------------------------------------------------------------
// ABIs — Human-Readable (ethers v6 format)
// -----------------------------------------------------------------

export const IDENTITY_REGISTRY_ABI = [
  // Identity management
  'function registerIdentity(address investor, address onchainId, string country) external',
  'function deleteIdentity(address investor) external',
  'function updateIdentity(address investor, address newOnchainId, string newCountry) external',
  // Boolean claims (backward-compatible)
  'function setClaim(address investor, uint256 topic, bool value) external',
  // ONCHAINID claims (cryptographic ERC-735)
  'function issueClaim(address investor, uint256 topic, address issuer, bytes signature, bytes data) external',
  // Required claim topics
  'function setRequiredClaimTopics(uint256[] topics) external',
  // Trusted Issuer management
  'function addTrustedIssuer(address issuer, uint256[] topics) external',
  'function removeTrustedIssuer(address issuer) external',
  'function setIdentityFactory(address factory) external',
  // Views
  'function isVerified(address investor) external view returns (bool)',
  'function contains(address investor) external view returns (bool)',
  'function identity(address investor) external view returns (address)',
  'function investorCountry(address investor) external view returns (string)',
  'function hasClaim(address investor, uint256 topic) external view returns (bool)',
  'function getRequiredClaimTopics() external view returns (uint256[])',
  'function getTrustedIssuers() view returns (address[])',
  'function getTrustedIssuersForTopic(uint256 topic) view returns (address[])',
  'function identityFactory() view returns (address)',
  'function isTrustedIssuer(address) view returns (bool)',
  // Multi-wallet linking (Cap. 622 Sybil protection)
  'function linkWallet(address wallet, address identityAddr, string country) external',
  'function unlinkWallet(address wallet) external',
  'function getLinkedWallets(address identityAddr) view returns (address[])',
  'function getIdentityForWallet(address wallet) view returns (address)',
  // Constants
  'function CLAIM_KYC_VERIFIED() view returns (uint256)',
  'function CLAIM_ACCREDITED_INVESTOR() view returns (uint256)',
  'function CLAIM_JURISDICTION_APPROVED() view returns (uint256)',
  'function CLAIM_SOURCE_OF_FUNDS() view returns (uint256)',
  'function CLAIM_PEP_SANCTIONS_CLEAR() view returns (uint256)',
  'function CLAIM_FPS_NAME_MATCH() view returns (uint256)',
  // Access Control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account) external',
  'function AGENT_ROLE() view returns (bytes32)',
  'function COMPLIANCE_OFFICER_ROLE() view returns (bytes32)',
  'function MLRO_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  // AML / STR (MLRO_ROLE)
  'function reportSuspiciousActivity(address account, bytes32 reportHash) external',
  'function getSTRRecords(address account) view returns (tuple(bytes32 reportHash, address reporter, uint256 timestamp)[])',
  'function getSTRCount(address account) view returns (uint256)',
  // CDD Record Anchoring (COMPLIANCE_OFFICER_ROLE)
  'function anchorCDDRecord(address investor, bytes32 cddHash, uint256 retentionYears) external',
  'function getCDDRecords(address investor) view returns (tuple(bytes32 cddHash, uint256 issuedAt, uint256 retentionExpiry)[])',
  'function hasCDDInRetention(address investor) view returns (bool)',
  // Pause
  'function pause() external',
  'function unpause() external',
  // Events
  'event IdentityRegistered(address indexed investor, address indexed identityContract, string country)',
  'event IdentityRemoved(address indexed investor)',
  'event ClaimSet(address indexed investor, uint256 indexed topic, bool value)',
  'event ClaimIssued(address indexed investor, uint256 indexed topic, address indexed issuer, bytes32 claimId)',
  'event TrustedIssuerAdded(address indexed issuer, uint256[] topics)',
  'event TrustedIssuerRemoved(address indexed issuer)',
  'event WalletLinked(address indexed wallet, address indexed identityContract)',
  'event WalletUnlinked(address indexed wallet, address indexed identityContract)',
  'event SuspiciousActivityReported(address indexed account, address indexed reporter, bytes32 reportHash, uint256 timestamp)',
  'event CDDRecordAnchored(address indexed investor, bytes32 indexed cddHash, uint256 issuedAt, uint256 retentionExpiry)',
];

export const COMPLIANCE_ABI = [
  // Oracle
  'function complianceOracle() view returns (address)',
  'function setComplianceOracle(address oracle) external',
  // Module config
  'function setConcentrationCap(address investor, uint256 cap) external',
  'function setGlobalConcentrationCap(uint256 cap) external',
  'function setJurisdiction(bytes2 jurisdiction, bool allowed) external',
  'function setLockUp(address investor, uint256 endTime) external',
  // Views
  'function concentrationCap(address investor) view returns (uint256)',
  'function globalConcentrationCap() view returns (uint256)',
  'function allowedJurisdictions(bytes2 jurisdiction) view returns (bool)',
  'function lockUpEnd(address investor) view returns (uint256)',
  'function domainSeparator() view returns (bytes32)',
  // Verification
  'function verifyAttestation(address from, address to, uint256 amount, uint256 expiry, uint256 nonce, bytes sig) view returns (bool)',
  'function consumeAttestation(address from, address to, uint256 amount, uint256 expiry, uint256 nonce, bytes sig) external returns (bool)',
  'function checkModules(address from, address to, uint256 amount, uint256 toBalance, bytes2 fromCountry, bytes2 toCountry) view returns (bool ok, string reason)',
  // Access Control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account) external',
  'function TOKEN_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  // Events
  'event JurisdictionSet(bytes2 indexed jurisdiction, bool allowed)',
  'event GlobalConcentrationCapSet(uint256 cap)',
  'event ConcentrationCapSet(address indexed investor, uint256 cap)',
  'event LockUpSet(address indexed investor, uint256 lockUpEnd)',
];

export const SECURITY_TOKEN_ABI = [
  // ERC-20
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  // Token management
  'function mint(address to, uint256 amount) external',
  'function burn(address from, uint256 amount) external',
  // Freeze
  'function setAddressFrozen(address account, bool isFrozen) external',
  'function frozen(address account) view returns (bool)',
  // Safe-list
  'function setSafeList(address account, bool status) external',
  'function safeListed(address account) view returns (bool)',
  // Registry / Compliance links
  'function identityRegistry() view returns (address)',
  'function compliance() view returns (address)',
  'function setIdentityRegistry(address newRegistry) external',
  'function setCompliance(address newCompliance) external',
  // Cap. 622 shareholder cap (identity-based)
  'function setMaxShareholders(uint256 cap) external',
  'function maxShareholders() view returns (uint256)',
  'function shareholderCount() view returns (uint256)',
  'function getIdentityHolders() view returns (address[])',
  'function aggregateBalanceByIdentity(address identityAddr) view returns (uint256)',
  // Pause
  'function pause() external',
  'function unpause() external',
  'function paused() view returns (bool)',
  // ERC20Votes — Checkpoint-based snapshot voting
  'function delegate(address delegatee) external',
  'function delegateBySig(address delegatee, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) external',
  'function delegates(address account) view returns (address)',
  'function getVotes(address account) view returns (uint256)',
  'function getPastVotes(address account, uint256 blockNumber) view returns (uint256)',
  'function getPastTotalSupply(uint256 blockNumber) view returns (uint256)',
  'function numCheckpoints(address account) view returns (uint32)',
  'function clock() view returns (uint48)',
  'function CLOCK_MODE() view returns (string)',
  // ERC20Permit
  'function nonces(address owner) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  // Access Control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account) external',
  'function revokeRole(bytes32 role, address account) external',
  'function AGENT_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  // Events
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event TokensMinted(address indexed to, uint256 amount, address indexed agent)',
  'event TokensBurned(address indexed from, uint256 amount, address indexed agent)',
  'event AddressFrozen(address indexed account, bool isFrozen, address indexed agent)',
  'event SafeListUpdated(address indexed account, bool status)',
  'event MaxShareholdersSet(uint256 maxShareholders)',
  'event IdentityHolderAdded(address indexed identityContract)',
  'event IdentityHolderRemoved(address indexed identityContract)',
  // ERC-1644 Forced Transfer (Settlement Finality)
  'function forcedTransfer(address from, address to, uint256 amount, bytes32 legalOrderHash, bytes operatorData) external',
  'function isControllable() view returns (bool)',
  'event ForcedTransfer(address indexed controller, address indexed from, address indexed to, uint256 amount, bytes32 legalOrderHash, bytes operatorData)',
];

export const CASH_TOKEN_ABI = [
  // ERC-20
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  // Mint / Burn (owner only)
  'function mint(address to, uint256 amount) external',
  'function burn(address from, uint256 amount) external',
  'function owner() view returns (address)',
  // Events
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

export const DVP_SETTLEMENT_ABI = [
  // Settlement lifecycle
  'function createSettlement(address seller, address buyer, address securityToken, uint256 tokenAmount, address cashToken, uint256 cashAmount, uint256 deadline, bytes32 matchId) external returns (uint256)',
  'function executeSettlement(uint256 id) external',
  'function cancelSettlement(uint256 id) external',
  // Views
  'function settlements(uint256 id) view returns (address seller, address buyer, address securityToken, uint256 tokenAmount, address cashToken, uint256 cashAmount, uint256 tradeTimestamp, uint256 settlementDeadline, uint8 status, bytes32 matchId)',
  'function settlementCount() view returns (uint256)',
  // Pause
  'function pause() external',
  'function unpause() external',
  // Access Control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account) external',
  'function OPERATOR_ROLE() view returns (bytes32)',
  'function PAUSER_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  // Events
  'event SettlementCreated(uint256 indexed id, bytes32 indexed matchId, address indexed seller, address buyer, address securityToken, uint256 tokenAmount, address cashToken, uint256 cashAmount, uint256 deadline)',
  'event SettlementExecuted(uint256 indexed id, bytes32 indexed matchId, address seller, address buyer, uint256 timestamp)',
  'event SettlementCancelled(uint256 indexed id, bytes32 indexed matchId, address indexed cancelledBy)',
  'event SettlementFailed(uint256 indexed id, bytes32 indexed matchId, string reason)',
  // Travel Rule (FATF Rec. 16)
  'function setTravelRuleData(uint256 settlementId, bytes32 originatorVASP, bytes32 beneficiaryVASP, bytes32 originatorInfoHash, bytes32 beneficiaryInfoHash) external',
  'function getTravelRuleData(uint256 settlementId) view returns (tuple(bytes32 originatorVASP, bytes32 beneficiaryVASP, bytes32 originatorInfoHash, bytes32 beneficiaryInfoHash, uint256 timestamp))',
  'function hasTravelRuleData(uint256 settlementId) view returns (bool)',
  'event TravelRuleDataRecorded(uint256 indexed settlementId, bytes32 originatorVASP, bytes32 beneficiaryVASP, bytes32 originatorInfoHash, bytes32 beneficiaryInfoHash, uint256 timestamp)',
  // Batch Settlement
  'function executeBatchSettlement(uint256[] ids, bool stopOnFailure) external returns (uint256 successCount, uint256 failCount)',
  'function markFailed(uint256 id) external',
  'event BatchSettlementExecuted(uint256[] indexed ids, uint256 successCount, uint256 failCount)',
];

// Claim topic mapping for display
export const CLAIM_TOPICS: Record<number, string> = {
  1: 'KYC Verified',
  2: 'Accredited Investor',
  3: 'Jurisdiction Approved',
  4: 'Source of Funds Verified',
  5: 'PEP/Sanctions Clear',
  6: 'FPS Name-Match Verified',
};

// -----------------------------------------------------------------
// Token Factory ABI
// -----------------------------------------------------------------
export const TOKEN_FACTORY_ABI = [
  'function createToken(string name, string symbol) returns (address)',
  'function deactivateToken(uint256 index)',
  'function reactivateToken(uint256 index)',
  'function tokenCount() view returns (uint256)',
  'function getToken(uint256 index) view returns (tuple(string name, string symbol, address tokenAddress, address createdBy, uint256 createdAt, bool active))',
  'function allTokens() view returns (tuple(string name, string symbol, address tokenAddress, address createdBy, uint256 createdAt, bool active)[])',
  'function activeTokens() view returns (tuple(string name, string symbol, address tokenAddress, address createdBy, uint256 createdAt, bool active)[])',
  'function getTokenBySymbol(string symbol) view returns (tuple(string name, string symbol, address tokenAddress, address createdBy, uint256 createdAt, bool active))',
  'function identityRegistry() view returns (address)',
  'function compliance() view returns (address)',
  'function tokenImplementation() view returns (address)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'event TokenCreated(uint256 indexed index, string name, string symbol, address tokenAddress, address createdBy)',
  'event TokenDeactivated(uint256 indexed index, address tokenAddress)',
  'event TokenReactivated(uint256 indexed index, address tokenAddress)',
];

// -----------------------------------------------------------------
// ONCHAINID ABIs (ERC-734 / ERC-735)
// -----------------------------------------------------------------

export const CLAIM_ISSUER_ABI = [
  'function signingKey() view returns (address)',
  'function setSigningKey(address newKey) external',
  'function isClaimValid(address identityContract, uint256 topic, bytes sig, bytes data) view returns (bool)',
  'function isClaimRevoked(bytes32 claimId) view returns (bool)',
  'function revokeClaim(bytes32 claimId) external',
  'function unrevokeClaim(bytes32 claimId) external',
  'function getClaimHash(address identityContract, uint256 topic, bytes data) pure returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'event ClaimRevoked(bytes32 indexed claimId)',
  'event ClaimUnrevoked(bytes32 indexed claimId)',
  'event SigningKeyUpdated(address indexed previous, address indexed current)',
];

export const IDENTITY_FACTORY_ABI = [
  'function deployIdentity(address investor, address claimAgent) external returns (address)',
  'function getIdentity(address investor) view returns (address)',
  'function deployedIdentity(address) view returns (address)',
  'function identityCount() view returns (uint256)',
  'function identityImplementation() view returns (address)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account) external',
  'function DEPLOYER_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'event IdentityDeployed(address indexed investor, address indexed identityContract, uint256 indexed index)',
];

export const IDENTITY_ABI = [
  // EIP-1167 initializer
  'function initialize(address initialManagementKey) external',
  // ERC-734 Key Management
  'function getKey(bytes32 key) view returns (uint256[] purposes, uint256 keyType, bytes32 keyValue)',
  'function keyHasPurpose(bytes32 key, uint256 purpose) view returns (bool)',
  'function addKey(bytes32 key, uint256 purpose, uint256 keyType) external',
  'function removeKey(bytes32 key, uint256 purpose) external',
  'function addressToKey(address addr) pure returns (bytes32)',
  // ERC-735 Claim Holder
  'function addClaim(uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri) external returns (bytes32)',
  'function removeClaim(bytes32 claimId) external',
  'function getClaim(bytes32 claimId) view returns (uint256 topic, uint256 scheme, address issuer, bytes signature, bytes data, string uri)',
  'function getClaimIdsByTopic(uint256 topic) view returns (bytes32[])',
  // Constants
  'function PURPOSE_MANAGEMENT() view returns (uint256)',
  'function PURPOSE_ACTION() view returns (uint256)',
  'function PURPOSE_CLAIM() view returns (uint256)',
  // Events
  'event KeyAdded(bytes32 indexed key, uint256 indexed purpose, uint256 indexed keyType)',
  'event KeyRemoved(bytes32 indexed key, uint256 indexed purpose, uint256 indexed keyType)',
  'event ClaimAdded(bytes32 indexed claimId, uint256 indexed topic, address indexed issuer)',
  'event ClaimRemoved(bytes32 indexed claimId, uint256 indexed topic, address indexed issuer)',
  'event ClaimChanged(bytes32 indexed claimId, uint256 indexed topic, address indexed issuer)',
];

// -----------------------------------------------------------------
// Governance ABIs
// -----------------------------------------------------------------

export const GOVERNOR_ABI = [
  // Proposal lifecycle
  'function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) returns (uint256)',
  'function queue(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) returns (uint256)',
  'function execute(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) payable returns (uint256)',
  'function cancel(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) returns (uint256)',
  'function castVote(uint256 proposalId, uint8 support) returns (uint256)',
  'function castVoteWithReason(uint256 proposalId, uint8 support, string reason) returns (uint256)',
  // Views
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function hashProposal(address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash) pure returns (uint256)',
  'function state(uint256 proposalId) view returns (uint8)',
  'function proposalSnapshot(uint256 proposalId) view returns (uint256)',
  'function proposalDeadline(uint256 proposalId) view returns (uint256)',
  'function proposalProposer(uint256 proposalId) view returns (address)',
  'function proposalEta(uint256 proposalId) view returns (uint256)',
  'function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)',
  'function hasVoted(uint256 proposalId, address account) view returns (bool)',
  'function votingDelay() view returns (uint256)',
  'function votingPeriod() view returns (uint256)',
  'function proposalThreshold() view returns (uint256)',
  'function quorum(uint256 blockNumber) view returns (uint256)',
  'function quorumNumerator() view returns (uint256)',
  'function quorumDenominator() view returns (uint256)',
  'function timelock() view returns (address)',
  'function token() view returns (address)',
  'function identityRegistry() view returns (address)',
  'function clock() view returns (uint48)',
  'function CLOCK_MODE() view returns (string)',
  'function COUNTING_MODE() pure returns (string)',
  // Events
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)',
  'event ProposalExecuted(uint256 proposalId)',
  'event ProposalCanceled(uint256 proposalId)',
  'event ProposalQueued(uint256 proposalId, uint256 etaSeconds)',
  'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)',
  'event VoteBlockedKYC(uint256 indexed proposalId, address indexed voter)',
];

export const TIMELOCK_ABI = [
  'function getMinDelay() view returns (uint256)',
  'function isOperation(bytes32 id) view returns (bool)',
  'function isOperationPending(bytes32 id) view returns (bool)',
  'function isOperationReady(bytes32 id) view returns (bool)',
  'function isOperationDone(bytes32 id) view returns (bool)',
  'function getOperationState(bytes32 id) view returns (uint8)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function PROPOSER_ROLE() view returns (bytes32)',
  'function EXECUTOR_ROLE() view returns (bytes32)',
  'function CANCELLER_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)',
  'event CallExecuted(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data)',
  'event Cancelled(bytes32 indexed id)',
  'event MinDelayChange(uint256 oldDuration, uint256 newDuration)',
];

// -----------------------------------------------------------------
// Wallet Architecture (98/2 Rule) ABIs
// -----------------------------------------------------------------

export const WALLET_REGISTRY_ABI = [
  // Wallet registration
  'function registerWallet(address wallet, uint8 tier, string label) external',
  'function deactivateWallet(address wallet) external',
  'function reactivateWallet(address wallet) external',
  'function changeWalletTier(address wallet, uint8 newTier) external',
  // Token tracking
  'function addTrackedToken(address token) external',
  'function removeTrackedToken(address token) external',
  // Hot cap
  'function setHotCapBps(uint256 newCapBps) external',
  'function hotCapBps() view returns (uint256)',
  // AUM & Balance queries
  'function totalAUM(address token) view returns (uint256)',
  'function hotBalance(address token) view returns (uint256)',
  'function warmBalance(address token) view returns (uint256)',
  'function coldBalance(address token) view returns (uint256)',
  'function hotCap(address token) view returns (uint256)',
  'function isHotOverCap(address token) view returns (bool)',
  'function tierBreakdown(address token) view returns (uint256 hotBal, uint256 warmBal, uint256 coldBal, uint256 total, uint256 hotCapVal, bool overCap)',
  // Cold wallet check
  'function canTransferFrom(address from) view returns (bool allowed, string reason)',
  // Sweep
  'function checkAndEmitSweep() external',
  'function recordSweep(address token, address from, address to, uint256 amount, string reason) external',
  // View helpers
  'function walletCount() view returns (uint256)',
  'function getWalletList() view returns (address[])',
  'function getTrackedTokens() view returns (address[])',
  'function sweepCount() view returns (uint256)',
  'function getWalletsByTier(uint8 tier) view returns (address[])',
  'function wallets(address) view returns (uint8 tier, string label, uint256 registeredAt, bool active)',
  'function sweepHistory(uint256) view returns (address token, address from, address to, uint256 amount, uint256 timestamp, string reason)',
  'function isTrackedToken(address) view returns (bool)',
  // Access control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function OPERATOR_ROLE() view returns (bytes32)',
  // Pause
  'function pause() external',
  'function unpause() external',
  // Events
  'event WalletRegistered(address indexed wallet, uint8 tier, string label)',
  'event WalletDeactivated(address indexed wallet)',
  'event WalletReactivated(address indexed wallet)',
  'event WalletTierChanged(address indexed wallet, uint8 oldTier, uint8 newTier)',
  'event HotCapUpdated(uint256 oldBps, uint256 newBps)',
  'event SweepRequired(address indexed token, uint256 hotBalance, uint256 cap, uint256 excess)',
  'event SweepExecuted(uint256 indexed recordId, address indexed token, address from, address to, uint256 amount, string reason)',
  'event ColdTransferBlocked(address indexed wallet, address indexed token, uint256 amount)',
];

export const MULTI_SIG_WARM_ABI = [
  // Propose / Confirm / Execute
  'function proposeTx(address token, address to, uint256 amount, string reason) returns (uint256)',
  'function confirmTx(uint256 txId) external',
  'function revokeConfirmation(uint256 txId) external',
  'function executeTx(uint256 txId) external',
  'function cancelTx(uint256 txId) external',
  // Signer management
  'function replaceSigner(uint256 index, address newSigner) external',
  // View helpers
  'function REQUIRED_CONFIRMATIONS() view returns (uint256)',
  'function MAX_SIGNERS() view returns (uint256)',
  'function EXPIRY_PERIOD() view returns (uint256)',
  'function transactionCount() view returns (uint256)',
  'function pendingCount() view returns (uint256)',
  'function getSigners() view returns (address[3])',
  'function isSigner(address) view returns (bool)',
  'function signers(uint256) view returns (address)',
  'function transactions(uint256) view returns (address token, address to, uint256 amount, string reason, uint256 proposedAt, bool executed, bool cancelled, uint256 confirmations)',
  'function confirmed(uint256, address) view returns (bool)',
  'function isExpired(uint256 txId) view returns (bool)',
  // Events
  'event TxProposed(uint256 indexed txId, address indexed proposer, address token, address to, uint256 amount, string reason)',
  'event TxConfirmed(uint256 indexed txId, address indexed signer)',
  'event TxRevoked(uint256 indexed txId, address indexed signer)',
  'event TxExecuted(uint256 indexed txId, address indexed executor)',
  'event TxCancelled(uint256 indexed txId, address indexed canceller)',
  'event SignerReplaced(uint256 indexed index, address indexed oldSigner, address indexed newSigner)',
];

export const SYSTEM_HEALTH_CHECK_ABI = [
  'function fullHealthCheck(tuple(address identityRegistry, address compliance, address securityToken, address cashToken, address dvpSettlement, address tokenFactory, address identityFactory, address governor, address timelock, address walletRegistry, address multiSigWarm, address expectedAdmin) a) view returns (tuple(uint256 timestamp, uint256 blockNumber, uint256 totalChecks, uint256 passedChecks, uint256 failedChecks, bool healthy) report, tuple(string name, bool passed, string detail)[] results)',
];

// -----------------------------------------------------------------
// OrderBook ABI
// -----------------------------------------------------------------
export const ORDER_BOOK_ABI = [
  // Place orders
  'function placeBuyOrder(uint256 price, uint256 quantity) returns (uint256)',
  'function placeSellOrder(uint256 price, uint256 quantity) returns (uint256)',
  // Cancel
  'function cancelOrder(uint256 orderId) external',
  // Views — order book
  'function getBuyOrderIds() view returns (uint256[])',
  'function getSellOrderIds() view returns (uint256[])',
  'function getTraderOrders(address trader) view returns (uint256[])',
  'function getOrder(uint256 orderId) view returns (tuple(uint256 id, address trader, uint8 side, uint256 price, uint256 quantity, uint256 filled, uint256 timestamp, uint8 status))',
  'function getOrdersBatch(uint256[] ids) view returns (tuple(uint256 id, address trader, uint8 side, uint256 price, uint256 quantity, uint256 filled, uint256 timestamp, uint8 status)[])',
  // Views — trades
  'function getTrade(uint256 tradeId) view returns (tuple(uint256 id, uint256 buyOrderId, uint256 sellOrderId, address buyer, address seller, uint256 price, uint256 quantity, uint256 cashAmount, uint256 timestamp))',
  'function getTradesBatch(uint256 from, uint256 to) view returns (tuple(uint256 id, uint256 buyOrderId, uint256 sellOrderId, address buyer, address seller, uint256 price, uint256 quantity, uint256 cashAmount, uint256 timestamp)[])',
  'function tradeCount() view returns (uint256)',
  'function orderCount() view returns (uint256)',
  // Views — market summary
  'function bestBid() view returns (uint256)',
  'function bestAsk() view returns (uint256)',
  'function spread() view returns (uint256)',
  // Token addresses
  'function securityToken() view returns (address)',
  'function cashToken() view returns (address)',
  'function securityDecimals() view returns (uint8)',
  'function cashDecimals() view returns (uint8)',
  'function identityRegistry() view returns (address)',
  // Pause
  'function pause() external',
  'function unpause() external',
  // Access Control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  // Events
  'event OrderPlaced(uint256 indexed orderId, address indexed trader, uint8 side, uint256 price, uint256 quantity, uint256 timestamp)',
  'event OrderCancelled(uint256 indexed orderId, address indexed trader, uint256 timestamp)',
  'event TradeExecuted(uint256 indexed tradeId, uint256 indexed buyOrderId, uint256 indexed sellOrderId, address buyer, address seller, uint256 price, uint256 quantity, uint256 cashAmount, uint256 timestamp)',
];

// -----------------------------------------------------------------
// OrderBookFactory ABI
// -----------------------------------------------------------------
export const ORDER_BOOK_FACTORY_ABI = [
  // Create market
  'function createOrderBook(address securityToken, uint8 secDecimals, string name, string symbol) returns (address)',
  // Deactivate / Reactivate
  'function deactivateMarket(uint256 index) external',
  'function reactivateMarket(uint256 index) external',
  // Views
  'function getOrderBook(address securityToken) view returns (address)',
  'function getMarket(uint256 index) view returns (tuple(address securityToken, address orderBook, string name, string symbol, uint256 createdAt, bool active))',
  'function allMarkets() view returns (tuple(address securityToken, address orderBook, string name, string symbol, uint256 createdAt, bool active)[])',
  'function activeMarkets() view returns (tuple(address securityToken, address orderBook, string name, string symbol, uint256 createdAt, bool active)[])',
  'function marketCount() view returns (uint256)',
  'function cashToken() view returns (address)',
  'function cashDecimals() view returns (uint8)',
  'function identityRegistry() view returns (address)',
  // Access Control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  // Events
  'event MarketCreated(uint256 indexed index, address indexed securityToken, address indexed orderBook, string name, string symbol)',
  'event MarketDeactivated(uint256 indexed index, address securityToken)',
  'event MarketReactivated(uint256 indexed index, address securityToken)',
];

