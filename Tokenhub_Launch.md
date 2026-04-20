# TokenHub Investor Portal – Launch Guide

## Prerequisites

- **Node.js** installed
- **Foundry / Anvil** installed (`~/.foundry/bin` on PATH)
- Working directory: `FITE7001_Capstone_Project`

## Step 1: Start Anvil

```powershell
$env:Path = "$env:USERPROFILE\.foundry\bin;$env:Path"
anvil --host 0.0.0.0 --port 8545 --no-request-size-limit
```

> **`--no-request-size-limit`** is required because the saved state snapshot exceeds Anvil's default 2 MB request body limit.

## Step 2: Load Saved State via RPC

In a **separate terminal**, run:

```powershell
cd C:\Users\ytcct\Downloads\Development\FITE7001_Capstone_Project

node -e "
  const fs = require('fs');
  const state = JSON.parse(fs.readFileSync('anvil-snapshot-2026-04-18T16-58-42.json', 'utf8'));
  const body = JSON.stringify({ jsonrpc: '2.0', method: 'anvil_loadState', params: [state], id: 1 });
  fetch('http://127.0.0.1:8545', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  }).then(r => r.json()).then(j => console.log(JSON.stringify(j)));
"
```

Expected output:

```json
{"jsonrpc":"2.0","id":1,"result":true}
```

## Step 2b: Fix Clock (Required)

The saved state contains blocks with future timestamps (due to governance fast-forwarding during testing). After loading, Anvil's wall clock is behind those timestamps, which causes `getPastVotes()` to return 0 — breaking proposal creation and voting.

Run this to advance the clock past the loaded state's latest block:

```powershell
node -e "
  const { ethers } = require('ethers');
  const p = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  (async () => {
    // Find the highest timestamp in loaded state
    const latest = await p.getBlock('latest');
    const target = Math.max(latest.timestamp, Math.floor(Date.now()/1000)) + 172800;
    await p.send('evm_setNextBlockTimestamp', ['0x' + target.toString(16)]);
    await p.send('evm_mine', []);
    const b = await p.getBlock('latest');
    console.log('Clock fixed. Block', b.number, 'at', new Date(b.timestamp * 1000).toISOString());
  })();
"
```

> **Why?** The token uses `block.timestamp` as its ERC-6372 clock. The Governor checks `getPastVotes(account, clock() - 1)` when proposing. If `clock()` (current timestamp) is earlier than the delegation checkpoint timestamps from the loaded state, votes appear as 0.

## Step 3: Start the Frontend

```powershell
cd frontend
npm run dev
```

The portal will be available at **http://localhost:3000/**.

### Accessing via VS Code Dev Tunnels (Remote Access)

If you need to access the portal remotely (e.g. from another machine or for demo purposes):

1. In VS Code, open the **Ports** panel (View → Ports) and forward port **3000** and **8545**
2. Set visibility to **Public** for port 3000
3. Start the frontend with the tunnel environment variable:

```powershell
cd frontend
$env:VITE_TUNNEL = "1"; npm run dev
```

4. Access via the tunnel URL (e.g. `https://xxxxx-3000.asse.devtunnels.ms/`)

> **Why `VITE_TUNNEL`?** Without it, Vite's HMR WebSocket tries to connect back to `localhost:3000`, which fails through the tunnel proxy with *"Connection header did not include 'upgrade'"*. Setting `VITE_TUNNEL=1` tells the HMR client to connect via the tunnel's HTTPS port (443) instead.

> **Note:** Restarting the frontend does **not** affect blockchain state — Anvil keeps all state in memory. You only need to reload state (`anvil_loadState`) if you restart Anvil itself.

## Important Notes

### Two Different State Formats

| Method | Format | Load With |
|--------|--------|-----------|
| `anvil_dumpState` RPC | Hex-encoded blob (`"0x1f8b..."`) | `anvil_loadState` RPC |
| `--dump-state` CLI flag | `SerializableState` JSON | `--load-state` CLI flag |

These formats are **not interchangeable**. The snapshot file `anvil-snapshot-2026-04-18T16-58-42.json` was created via `anvil_dumpState` RPC, so it **must** be loaded via `anvil_loadState` RPC — not `--load-state`.

### Saving a New Snapshot

```powershell
node -e "
  fetch('http://127.0.0.1:8545', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'anvil_dumpState', params: [], id: 1 })
  }).then(r => r.json()).then(j => {
    const fs = require('fs');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = 'anvil-snapshot-' + ts + '.json';
    fs.writeFileSync(filename, JSON.stringify(j.result));
    console.log('Saved to ' + filename);
  });
"
```

> **Never overwrite existing snapshot files** — always use timestamped filenames.

## Environment Summary

| Component | URL | Chain ID |
|-----------|-----|----------|
| Anvil RPC | http://127.0.0.1:8545 | 31337 |
| Frontend (Vite) | http://localhost:3000 | — |
