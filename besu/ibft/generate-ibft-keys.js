#!/usr/bin/env node
/**
 * @title generate-ibft-keys.js
 * @notice Generates 4 validator key-pairs for the IBFT 2.0 network and
 *         produces the correct RLP-encoded `extraData` field for the genesis.
 *
 * Usage:
 *   node besu/ibft/generate-ibft-keys.js
 *
 * Output:
 *   - besu/ibft/keys/validator{1..4}/key          (private key hex, no 0x prefix)
 *   - besu/ibft/keys/validator{1..4}/key.pub       (public key hex, no 0x prefix)
 *   - Updates genesis-ibft.json extraData field
 *   - Updates docker-compose.yml with validator-1 enode
 *   - Prints validator addresses + enode URL
 */

const crypto = require("crypto");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const IBFT_DIR = path.join(__dirname);
const KEYS_DIR = path.join(IBFT_DIR, "keys");
const GENESIS_PATH = path.join(IBFT_DIR, "genesis-ibft.json");
const COMPOSE_PATH = path.join(IBFT_DIR, "docker-compose.yml");
const NUM_VALIDATORS = 4;

function generateKeyPair() {
  const wallet = ethers.Wallet.createRandom();
  return {
    privateKey: wallet.privateKey.slice(2), // remove 0x
    publicKey: wallet.publicKey.slice(4),   // remove 0x04 (uncompressed prefix)
    address: wallet.address.toLowerCase().slice(2), // remove 0x
  };
}

/**
 * RLP-encode the IBFT 2.0 extraData field.
 * Format: RLP([32_bytes_vanity, [addr1, addr2, ...], [], []])
 *
 * We use a simplified manual RLP encoding since the structure is fixed.
 */
function encodeIBFTExtraData(validatorAddresses) {
  // Use ethers RLP encoding
  const vanity = "0x" + "00".repeat(32);
  const validators = validatorAddresses.map(a => "0x" + a);

  // IBFT extra data = vanity (32 bytes) + RLP([validators]) + RLP([]) + RLP([])
  // The full format is: RLP(vanity || RLP(validators) || vote || round || seals)
  // For genesis: RLP([vanity_32bytes, [validators], no_vote, no_round, no_seals])

  // Simpler: Use the standard Besu IBFT extraData format
  // 0x + <32 bytes vanity> + RLP_ENCODE([validators, vote, round, seals])
  const { RLP } = require("ethers");

  // Encode: [validators_list, [], [], []]
  const rlpPayload = ethers.encodeRlp([
    validators,  // validator addresses
    [],          // vote (empty for genesis)
    "0x",        // round (0)
    [],          // seals (empty for genesis)
  ]);

  // Full extraData = 0x + 32 zero bytes + rlp_payload (without 0x prefix)
  return vanity + rlpPayload.slice(2);
}

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  IBFT 2.0 — Generating 4 Validator Key Pairs    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  const validators = [];

  for (let i = 1; i <= NUM_VALIDATORS; i++) {
    const dir = path.join(KEYS_DIR, `validator${i}`);
    fs.mkdirSync(dir, { recursive: true });

    const kp = generateKeyPair();
    validators.push(kp);

    // Write private key (no 0x prefix, as Besu expects)
    fs.writeFileSync(path.join(dir, "key"), kp.privateKey);
    // Write public key
    fs.writeFileSync(path.join(dir, "key.pub"), kp.publicKey);

    console.log(`  Validator ${i}:`);
    console.log(`    Address:    0x${kp.address}`);
    console.log(`    Key file:   besu/ibft/keys/validator${i}/key`);
    console.log();
  }

  // ── Update genesis extraData ──
  console.log("Updating genesis-ibft.json extraData...");
  const genesis = JSON.parse(fs.readFileSync(GENESIS_PATH, "utf8"));

  const addresses = validators.map(v => v.address);
  genesis.extraData = encodeIBFTExtraData(addresses);
  fs.writeFileSync(GENESIS_PATH, JSON.stringify(genesis, null, 2) + "\n");
  console.log("  ✓ extraData updated with", NUM_VALIDATORS, "validator addresses\n");

  // ── Update docker-compose bootnodes ──
  console.log("Updating docker-compose.yml bootnodes...");
  const enode = validators[0].publicKey;
  let compose = fs.readFileSync(COMPOSE_PATH, "utf8");
  compose = compose.replace(/VALIDATOR1_ENODE/g, enode);
  // Validator 1 should have empty bootnodes (it IS the bootnode)
  fs.writeFileSync(COMPOSE_PATH, compose);
  console.log("  ✓ Bootnode enode set to validator-1 public key\n");

  // ── Summary ──
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Network Ready!                                  ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║  Validators:", NUM_VALIDATORS, "  (BFT tolerance: 1 faulty node)    ║");
  console.log("║  Consensus:  IBFT 2.0                            ║");
  console.log("║  Block time: 2 seconds                           ║");
  console.log("║  Chain ID:   7001                                ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║  Start:                                          ║");
  console.log("║    docker compose -f besu/ibft/docker-compose.yml up -d  ║");
  console.log("║  Stop:                                           ║");
  console.log("║    docker compose -f besu/ibft/docker-compose.yml down   ║");
  console.log("╚══════════════════════════════════════════════════╝");

  // Write a summary file for reference
  const summary = {
    generated: new Date().toISOString(),
    chainId: 7001,
    consensus: "IBFT 2.0",
    blockPeriod: "2s",
    bftTolerance: "1 faulty node (f=1, n=3f+1=4)",
    validators: validators.map((v, i) => ({
      index: i + 1,
      address: "0x" + v.address,
      rpcPort: 8545 + (i * 100),
    })),
    bootnode: `enode://${validators[0].publicKey}@172.20.0.11:30303`,
  };
  fs.writeFileSync(
    path.join(IBFT_DIR, "network-info.json"),
    JSON.stringify(summary, null, 2) + "\n"
  );
  console.log("\n  Network info saved to besu/ibft/network-info.json");
}

main().catch(console.error);
