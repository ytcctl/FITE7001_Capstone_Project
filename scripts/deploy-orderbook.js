/**
 * @title deploy-orderbook.js
 * @notice Deploy OrderBook to Besu.
 *
 * Includes an embedded Engine-API block producer so the deployment
 * is self-contained (Besu PoS does not auto-mine blocks).
 *
 * Usage:
 *   npx hardhat run scripts/deploy-orderbook.js --network besu
 */
const { ethers } = require("hardhat");

// ---------------------------------------------------------------------------
// Embedded Engine-API block producer
// ---------------------------------------------------------------------------
const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:8551";
const ETH_URL    = process.env.ETH_URL    || "http://127.0.0.1:8545";

let rpcId = 1;
async function engineRpc(url, method, params = []) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: rpcId++ });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = await res.json();
  if (json.error)
    throw new Error(`${method}: ${json.error.message} (code ${json.error.code})`);
  return json.result;
}

async function produceOneBlock() {
  const latest = await engineRpc(ETH_URL, "eth_getBlockByNumber", ["latest", false]);
  const parentHash = latest.hash;
  const timestamp = Math.max(
    Math.floor(Date.now() / 1000),
    parseInt(latest.timestamp, 16) + 1
  );
  const timestampHex = "0x" + timestamp.toString(16);
  const zeroHash = "0x" + "0".repeat(64);

  const fcu = await engineRpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    { headBlockHash: parentHash, safeBlockHash: parentHash, finalizedBlockHash: parentHash },
    {
      timestamp: timestampHex,
      prevRandao: zeroHash,
      suggestedFeeRecipient: "0xfe3b557e8fb62b89f4916b721be55ceb828dbd73",
      withdrawals: [],
      parentBeaconBlockRoot: zeroHash,
    },
  ]);
  if (!fcu.payloadId) return null;

  const payload = await engineRpc(ENGINE_URL, "engine_getPayloadV3", [fcu.payloadId]);
  const ep = payload.executionPayload;
  const blobs = payload.blobsBundle || { commitments: [], proofs: [], blobs: [] };

  const np = await engineRpc(ENGINE_URL, "engine_newPayloadV3", [
    ep,
    blobs.commitments || [],
    ep.parentBeaconBlockRoot || zeroHash,
  ]);
  if (np.status !== "VALID") {
    console.error("  ⚠  newPayload status:", np.status, np.validationError || "");
    return null;
  }

  await engineRpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    { headBlockHash: ep.blockHash, safeBlockHash: ep.blockHash, finalizedBlockHash: ep.blockHash },
    null,
  ]);
  return { number: parseInt(ep.blockNumber, 16), txCount: (ep.transactions || []).length };
}

function startBlockProducer() {
  let running = true;
  const promise = (async () => {
    while (running) {
      try {
        const pending = await engineRpc(ETH_URL, "txpool_besuStatistics", [])
          .then((r) => (r.localCount || 0) + (r.remoteCount || 0))
          .catch(() => 0);
        if (pending > 0) {
          const blk = await produceOneBlock();
          if (blk) console.log(`  ⛏  Block #${blk.number}  txs=${blk.txCount}`);
        }
      } catch (err) {
        // swallow — let deploy continue
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  return { stop: () => { running = false; return promise; } };
}

// ---------------------------------------------------------------------------
// Deployed contract addresses (must match contracts.ts)
// ---------------------------------------------------------------------------
const SECURITY_TOKEN = "0x6aA8b700cD034Ab4B897B59447f268b33B8cF699";
const CASH_TOKEN     = "0xc83003B2AD5C3EF3e93Cc3Ef0a48E84dc8DBD718";

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying OrderBook with account:", deployer.address);
  console.log("  Security Token:", SECURITY_TOKEN);
  console.log("  Cash Token:    ", CASH_TOKEN);

  const blockProducer = startBlockProducer();

  try {
    const Factory = await ethers.getContractFactory("OrderBook");
    // constructor(securityToken, cashToken, secDecimals, cashDecimals, admin)
    const contract = await Factory.deploy(
      SECURITY_TOKEN,
      CASH_TOKEN,
      18,   // HKSTPSecurityToken decimals
      6,    // MockCashToken decimals
      deployer.address
    );
    await contract.waitForDeployment();
    const addr = await contract.getAddress();

    console.log("\n✅ OrderBook deployed to:", addr);
    console.log("\nUpdate frontend/src/config/contracts.ts:");
    console.log(`  orderBook: '${addr}',`);
  } finally {
    await blockProducer.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
