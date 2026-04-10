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
  identityRegistry: '0x0000000000000000000000000000000000000000',
  compliance: '0x0000000000000000000000000000000000000000',
  securityToken: '0x0000000000000000000000000000000000000000',
  cashToken: '0x0000000000000000000000000000000000000000',
  dvpSettlement: '0x0000000000000000000000000000000000000000',
};

// -----------------------------------------------------------------
// ABIs — Human-Readable (ethers v6 format)
// -----------------------------------------------------------------

export const IDENTITY_REGISTRY_ABI = [
  // Identity management
  'function registerIdentity(address investor, address onchainId, string country) external',
  'function deleteIdentity(address investor) external',
  'function updateIdentity(address investor, address newOnchainId, string newCountry) external',
  // Claims
  'function setClaim(address investor, uint256 topic, bool value) external',
  'function setRequiredClaimTopics(uint256[] topics) external',
  // Views
  'function isVerified(address investor) external view returns (bool)',
  'function contains(address investor) external view returns (bool)',
  'function identity(address investor) external view returns (address)',
  'function investorCountry(address investor) external view returns (string)',
  'function hasClaim(address investor, uint256 topic) external view returns (bool)',
  'function getRequiredClaimTopics() external view returns (uint256[])',
  // Constants
  'function CLAIM_KYC_VERIFIED() view returns (uint256)',
  'function CLAIM_ACCREDITED_INVESTOR() view returns (uint256)',
  'function CLAIM_JURISDICTION_APPROVED() view returns (uint256)',
  'function CLAIM_SOURCE_OF_FUNDS() view returns (uint256)',
  'function CLAIM_PEP_SANCTIONS_CLEAR() view returns (uint256)',
  // Access Control
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function grantRole(bytes32 role, address account) external',
  'function AGENT_ROLE() view returns (bytes32)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  // Pause
  'function pause() external',
  'function unpause() external',
  // Events
  'event IdentityRegistered(address indexed investor, address indexed onchainId, string country)',
  'event IdentityRemoved(address indexed investor)',
  'event ClaimSet(address indexed investor, uint256 indexed topic, bool value)',
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
  // Pause
  'function pause() external',
  'function unpause() external',
  'function paused() view returns (bool)',
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
];

// Claim topic mapping for display
export const CLAIM_TOPICS: Record<number, string> = {
  1: 'KYC Verified',
  2: 'Accredited Investor',
  3: 'Jurisdiction Approved',
  4: 'Source of Funds Verified',
  5: 'PEP/Sanctions Clear',
};
