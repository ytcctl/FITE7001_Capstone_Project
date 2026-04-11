/**
 * Burn excess tokens so balances match MetaMask (10,000 HKSAT / 5,000,000 THKD)
 */
const { ethers } = require("hardhat");

const ENGINE_URL = "http://127.0.0.1:8551";
const ETH_URL   = "http://127.0.0.1:8545";
let rpcId = 1;

async function engineRpc(url, method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: rpcId++ }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function produceBlock() {
  const latest = await engineRpc(ETH_URL, "eth_getBlockByNumber", ["latest", false]);
  const ts = Math.max(Math.floor(Date.now() / 1000), parseInt(latest.timestamp, 16) + 1);
  const z = "0x" + "0".repeat(64);
  const fcu = await engineRpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    { headBlockHash: latest.hash, safeBlockHash: latest.hash, finalizedBlockHash: latest.hash },
    { timestamp: "0x" + ts.toString(16), prevRandao: z, suggestedFeeRecipient: "0xfe3b557e8fb62b89f4916b721be55ceb828dbd73", withdrawals: [], parentBeaconBlockRoot: z },
  ]);
  if (!fcu.payloadId) return;
  const payload = await engineRpc(ENGINE_URL, "engine_getPayloadV3", [fcu.payloadId]);
  const ep = payload.executionPayload;
  const blobs = payload.blobsBundle || { commitments: [], proofs: [], blobs: [] };
  await engineRpc(ENGINE_URL, "engine_newPayloadV3", [ep, blobs.commitments || [], ep.parentBeaconBlockRoot || z]);
  await engineRpc(ENGINE_URL, "engine_forkchoiceUpdatedV3", [
    { headBlockHash: ep.blockHash, safeBlockHash: ep.blockHash, finalizedBlockHash: ep.blockHash }, null,
  ]);
  console.log("  ⛏  Block #" + parseInt(ep.blockNumber, 16));
}

async function main() {
  const INVESTOR = "0x5e33E2E5333DD9b7b428AC38AE361E9b707046f3";
  const tok  = await ethers.getContractAt("HKSTPSecurityToken", "0x4cf5ff8672BC73A108744927083893662b3C38D5");
  const cash = await ethers.getContractAt("MockCashToken", "0xfa584f21aEE65BfE18033224A0c45B5636556564");

  const hksatBal = await tok.balanceOf(INVESTOR);
  const thkdBal  = await cash.balanceOf(INVESTOR);
  console.log("Current HKSAT:", ethers.formatUnits(hksatBal, 18));
  console.log("Current THKD: ", ethers.formatUnits(thkdBal, 6));

  const targetHKSAT = ethers.parseUnits("10000", 18);
  const targetTHKD  = ethers.parseUnits("5000000", 6);

  if (hksatBal > targetHKSAT) {
    const excess = hksatBal - targetHKSAT;
    console.log(`\nBurning ${ethers.formatUnits(excess, 18)} excess HKSAT...`);
    await (await tok.burn(INVESTOR, excess)).wait();
    await produceBlock();
  }

  if (thkdBal > targetTHKD) {
    const excess = thkdBal - targetTHKD;
    console.log(`Burning ${ethers.formatUnits(excess, 6)} excess THKD...`);
    await (await cash.burn(INVESTOR, excess)).wait();
    await produceBlock();
  }

  const finalH = await tok.balanceOf(INVESTOR);
  const finalT = await cash.balanceOf(INVESTOR);
  console.log("\n✓ Final HKSAT:", ethers.formatUnits(finalH, 18));
  console.log("✓ Final THKD: ", ethers.formatUnits(finalT, 6));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
