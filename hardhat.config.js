require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config({ path: process.env.DOTENV_PATH || ".env.besu" });

// Dev-mode private keys (same as Besu dev accounts — public knowledge, NOT for production)
const DEV_KEYS = [
  "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63", // Deployer/Admin  0xFE3B557E...
  "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3", // Operator        0x62730609...
  "0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f", // Agent/Custodian  0xf17f5215...
  "0x0dbbe8e4ae425a6d2687f1a7e3ba17bc98c673636790f1b8ad91193c05875ef1", // Seller           0xC5fdf407...
  "0xc88b703fb08cbea894b6aeff5a544fb92e78a18e19814cd85da83b71f772aa6c", // Buyer            0x821aEa9a...
];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: DEV_KEYS.map((key) => ({
        privateKey: key,
        balance: "1000000000000000000000000", // 1 000 000 ETH each
      })),
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: DEV_KEYS,
    },
    besu: {
      url: process.env.BESU_RPC_URL || "http://127.0.0.1:8545",
      chainId: parseInt(process.env.BESU_CHAIN_ID || "31337"),
      accounts: process.env.BESU_PRIVATE_KEYS
        ? process.env.BESU_PRIVATE_KEYS.split(",")
        : DEV_KEYS,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
};
