/**
 * @title block-producer.js
 * @notice Lightweight Engine-API block producer for a post-merge Besu devnet.
 *
 * Besu's `--network=dev` only supports the London EVM fork.
 * To use Cancun (required by OpenZeppelin v5), we run Besu with a custom
 * genesis that sets terminalTotalDifficulty=0 and cancunTime=0.
 * Since there is no real beacon chain, this script drives block production
 * via the Engine API (engine_forkchoiceUpdatedV3, engine_getPayloadV3,
 * engine_newPayloadV3).
 *
 * Usage:
 *   node besu/block-producer.js                      # default: poll every 1 s
 *   node besu/block-producer.js --interval 500        # poll every 500 ms
 *
 * Environment:
 *   ENGINE_URL   — Engine API endpoint (default http://127.0.0.1:8551)
 *   ETH_URL      — JSON-RPC endpoint  (default http://127.0.0.1:8545)
 */

const ENGINE_URL = process.env.ENGINE_URL || "http://127.0.0.1:8551";
const ETH_URL = process.env.ETH_URL || "http://127.0.0.1:8545";

// Catch unhandled errors so the process doesn't silently die
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

// Parse --interval flag
let INTERVAL = 1000;
const idx = process.argv.indexOf("--interval");
if (idx !== -1 && process.argv[idx + 1]) {
  INTERVAL = parseInt(process.argv[idx + 1], 10);
}

let rpcId = 1;

async function rpc(url, method, params = []) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params, id: rpcId++ });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = await res.json();
  if (json.error) {
    throw new Error(`${method}: ${json.error.message} (code ${json.error.code})`);
  }
  return json.result;
}

/** Fetch the latest block from the EL */
async function getLatestBlock() {
  return rpc(ETH_URL, "eth_getBlockByNumber", ["latest", false]);
}

/** Get the pending tx count (uses Besu-specific txpool API) */
async function pendingTxCount() {
  try {
    const res = await rpc(ETH_URL, "txpool_besuStatistics", []);
    return (res.localCount || 0) + (res.remoteCount || 0);
  } catch {
    // Fallback: try standard method
    const res = await rpc(ETH_URL, "eth_getBlockTransactionCountByNumber", ["pending"]);
    return parseInt(res, 16);
  }
}

/**
 * Produce one block using the Engine API V3 (Cancun).
 * Returns the new block hash or null if no block was produced.
 */
async function produceBlock(parentBlock) {
  const parentHash = parentBlock.hash;
  const timestamp = Math.max(
    Math.floor(Date.now() / 1000),
    parseInt(parentBlock.timestamp, 16) + 1
  );

  const timestampHex = "0x" + timestamp.toString(16);

  // 1) engine_forkchoiceUpdatedV3 — tell Besu to start building a payload
  const fcu = await rpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    {
      headBlockHash: parentHash,
      safeBlockHash: parentHash,
      finalizedBlockHash: parentHash,
    },
    {
      timestamp: timestampHex,
      prevRandao: "0x0000000000000000000000000000000000000000000000000000000000000000",
      suggestedFeeRecipient: "0xfe3b557e8fb62b89f4916b721be55ceb828dbd73",
      withdrawals: [],
      parentBeaconBlockRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    },
  ]);

  if (!fcu.payloadId) {
    // No payload started — possibly nothing to include
    return null;
  }

  // 2) engine_getPayloadV3 — retrieve the assembled payload
  const payload = await rpc(ENGINE_URL, "engine_getPayloadV3", [fcu.payloadId]);

  const executionPayload = payload.executionPayload;
  const blobsBundle = payload.blobsBundle || { commitments: [], proofs: [], blobs: [] };

  // 3) engine_newPayloadV3 — submit the payload for execution
  const np = await rpc(ENGINE_URL, "engine_newPayloadV3", [
    executionPayload,
    blobsBundle.commitments || [],
    executionPayload.parentBeaconBlockRoot ||
      "0x0000000000000000000000000000000000000000000000000000000000000000",
  ]);

  if (np.status !== "VALID") {
    console.error("  ⚠  newPayload status:", np.status, np.validationError || "");
    return null;
  }

  // 4) engine_forkchoiceUpdatedV3 — set the new head
  await rpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    {
      headBlockHash: executionPayload.blockHash,
      safeBlockHash: executionPayload.blockHash,
      finalizedBlockHash: executionPayload.blockHash,
    },
    null,
  ]);

  return {
    hash: executionPayload.blockHash,
    number: parseInt(executionPayload.blockNumber, 16),
    txCount: executionPayload.transactions ? executionPayload.transactions.length : 0,
  };
}

// -----------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------
async function main() {
  console.log(`Block producer started`);
  console.log(`  Engine API : ${ENGINE_URL}`);
  console.log(`  ETH RPC    : ${ETH_URL}`);
  console.log(`  Poll interval : ${INTERVAL}ms`);
  console.log(`  Press Ctrl+C to stop.\n`);

  let lastBlockNumber = -1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const latest = await getLatestBlock();
      const currentNumber = parseInt(latest.number, 16);

      // Only produce a block when there are pending transactions,
      // OR if we haven't produced the genesis successor yet.
      const pending = await pendingTxCount();
      const shouldProduce = pending > 0 || currentNumber === 0;

      if (shouldProduce) {
        const result = await produceBlock(latest);
        if (result && result.number !== lastBlockNumber) {
          console.log(
            `  ✓ Block #${result.number}  txs=${result.txCount}  hash=${result.hash.slice(0, 18)}…`
          );
          lastBlockNumber = result.number;
        }
      }
    } catch (err) {
      // Don't crash — just log and retry
      console.error("  ✗ Loop error:", err);
    }

    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
