/**
 * @title deploy.js
 * @notice Deployment script for the TokenHub smart contract suite.
 *
 * Deployment order:
 *   1. HKSTPIdentityRegistry
 *   2. HKSTPCompliance
 *   3. HKSTPSecurityToken (linked to registry + compliance)
 *   4. MockCashToken (tokenized HKD)
 *   5. DvPSettlement
 *
 * Post-deployment configuration:
 *   - Grant TOKEN_ROLE on compliance to the security token
 *   - Safe-list treasury, escrow, and custodian addresses
 *   - Print all deployed addresses
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network localhost
 *   npx hardhat run scripts/deploy.js --network besu
 *
 * Environment variables:
 *   COMPLIANCE_ORACLE  — address of the Compliance Oracle signing key
 *   TREASURY_ADDRESS   — treasury wallet to safe-list
 *   ESCROW_ADDRESS     — escrow wallet to safe-list
 *   CUSTODIAN_ADDRESS  — licensed custodian wallet
 */

const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  const deployer  = signers[0];
  const operator  = signers.length > 1 ? signers[1] : deployer;
  const agent     = signers.length > 2 ? signers[2] : deployer;  // agent / custodian
  const seller    = signers.length > 3 ? signers[3] : deployer;
  const buyer     = signers.length > 4 ? signers[4] : deployer;

  console.log("Deploying with account:", deployer.address);
  console.log("Operator :", operator.address);
  console.log("Agent    :", agent.address);
  console.log("Seller   :", seller.address);
  console.log("Buyer    :", buyer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // Configuration — fall back to deployer address for testing
  const complianceOracle = process.env.COMPLIANCE_ORACLE || deployer.address;
  const treasuryAddress  = process.env.TREASURY_ADDRESS  || deployer.address;
  const escrowAddress    = process.env.ESCROW_ADDRESS    || deployer.address;
  const custodianAddress = agent.address;

  // -------------------------------------------------------------------------
  // 1. Deploy HKSTPIdentityRegistry
  // -------------------------------------------------------------------------
  console.log("1/5  Deploying HKSTPIdentityRegistry...");
  const IdentityRegistry = await ethers.getContractFactory("HKSTPIdentityRegistry");
  const registry = await IdentityRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("     HKSTPIdentityRegistry:", registryAddress);

  // -------------------------------------------------------------------------
  // 2. Deploy HKSTPCompliance
  // -------------------------------------------------------------------------
  console.log("2/5  Deploying HKSTPCompliance...");
  const Compliance = await ethers.getContractFactory("HKSTPCompliance");
  const compliance = await Compliance.deploy(deployer.address, complianceOracle);
  await compliance.waitForDeployment();
  const complianceAddress = await compliance.getAddress();
  console.log("     HKSTPCompliance:", complianceAddress);
  console.log("     Compliance Oracle:", complianceOracle);

  // -------------------------------------------------------------------------
  // 3. Deploy HKSTPSecurityToken
  //    (Example: "HKSTP Alpha Startup Token" — one token per HKSTP startup)
  // -------------------------------------------------------------------------
  console.log("3/5  Deploying HKSTPSecurityToken...");
  const Token = await ethers.getContractFactory("HKSTPSecurityToken");
  const token = await Token.deploy(
    "HKSTP Alpha Startup Token",
    "HKSAT",
    registryAddress,
    complianceAddress,
    ethers.ZeroAddress, // onchainId — set post-deployment when ONCHAINID is available
    deployer.address
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("     HKSTPSecurityToken:", tokenAddress);

  // -------------------------------------------------------------------------
  // 4. Deploy MockCashToken (tokenized HKD, 6 decimals)
  // -------------------------------------------------------------------------
  console.log("4/5  Deploying MockCashToken (tokenized HKD)...");
  const MockCash = await ethers.getContractFactory("MockCashToken");
  const cashToken = await MockCash.deploy(
    "Tokenized HKD",
    "THKD",
    6,
    deployer.address
  );
  await cashToken.waitForDeployment();
  const cashTokenAddress = await cashToken.getAddress();
  console.log("     MockCashToken (THKD):", cashTokenAddress);

  // -------------------------------------------------------------------------
  // 5. Deploy DvPSettlement
  // -------------------------------------------------------------------------
  console.log("5/5  Deploying DvPSettlement...");
  const DvP = await ethers.getContractFactory("DvPSettlement");
  const dvp = await DvP.deploy(deployer.address);
  await dvp.waitForDeployment();
  const dvpAddress = await dvp.getAddress();
  console.log("     DvPSettlement:", dvpAddress);

  // -------------------------------------------------------------------------
  // Post-deployment configuration
  // -------------------------------------------------------------------------
  console.log("\nConfiguring roles and safe-list...");

  // Grant TOKEN_ROLE on compliance to the security token contract
  // (allows the token to call checkModules)
  const TOKEN_ROLE = await compliance.TOKEN_ROLE();
  await (await compliance.grantRole(TOKEN_ROLE, tokenAddress)).wait();
  console.log("     TOKEN_ROLE granted to HKSTPSecurityToken on HKSTPCompliance");

  // Grant OPERATOR_ROLE on DvP to the operator account
  const OPERATOR_ROLE = await dvp.OPERATOR_ROLE();
  await (await dvp.grantRole(OPERATOR_ROLE, operator.address)).wait();
  console.log("     OPERATOR_ROLE granted to operator on DvPSettlement:", operator.address);

  // Grant AGENT_ROLE on BOTH IdentityRegistry and SecurityToken to the agent/custodian
  const AGENT_ROLE_TOKEN    = await token.AGENT_ROLE();
  const AGENT_ROLE_REGISTRY = await registry.AGENT_ROLE();
  await (await token.grantRole(AGENT_ROLE_TOKEN, agent.address)).wait();
  console.log("     AGENT_ROLE granted to agent on HKSTPSecurityToken:", agent.address);
  await (await registry.grantRole(AGENT_ROLE_REGISTRY, agent.address)).wait();
  console.log("     AGENT_ROLE granted to agent on HKSTPIdentityRegistry:", agent.address);

  // Safe-list operational addresses (treasury, escrow, custodian)
  const operationalAddresses = [
    { name: "Treasury",  addr: treasuryAddress },
    { name: "Escrow",    addr: escrowAddress   },
  ];
  for (const op of operationalAddresses) {
    if (op.addr !== deployer.address) {
      await (await token.setSafeList(op.addr, true)).wait();
      console.log(`     Safe-listed ${op.name}: ${op.addr}`);
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║               TokenHub Deployment Summary                   ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║ HKSTPIdentityRegistry : ${registryAddress}  ║`);
  console.log(`║ HKSTPCompliance       : ${complianceAddress}  ║`);
  console.log(`║ HKSTPSecurityToken    : ${tokenAddress}  ║`);
  console.log(`║ MockCashToken (THKD)  : ${cashTokenAddress}  ║`);
  console.log(`║ DvPSettlement         : ${dvpAddress}  ║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log(`║ Compliance Oracle     : ${complianceOracle}  ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝");

  return {
    registry:     registryAddress,
    compliance:   complianceAddress,
    token:        tokenAddress,
    cashToken:    cashTokenAddress,
    dvp:          dvpAddress,
  };
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
