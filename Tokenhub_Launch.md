# TokenHub Investor Portal – Launch Guide

## Prerequisites

- **Node.js** installed (only needed for the frontend dev server and the clock-fix step)
- **Foundry / Anvil** installed (`~/.foundry/bin` on PATH)
- **PowerShell 5.1+** (default on Windows 10/11) — used for all RPC calls
- Frontend deps installed: `cd frontend && npm install`
- Working directory: `FITE7001_Capstone_Project`

## Quick Start (TL;DR)

```powershell
# Terminal 1 — start Anvil
$env:Path = "$env:USERPROFILE\.foundry\bin;$env:Path"
anvil --host 0.0.0.0 --port 8545 --no-request-size-limit

# Terminal 2 — load state via PowerShell, fix clock, run frontend
cd C:\Users\ASUS\Downloads\FITE7001_Capstone_Project
$state = (Get-Content -Raw 'anvil-snapshot-post-redeploy-2026-04-26T15-28-51.json').Trim()
$body  = '{"jsonrpc":"2.0","method":"anvil_loadState","params":["' + $state + '"],"id":1}'
Invoke-WebRequest -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body)) -UseBasicParsing | Select-Object -ExpandProperty Content
# (then run the clock-fix snippet from Step 2b)
cd frontend
npm run dev
```

Open **http://localhost:3000/**.

## Step 1: Start Anvil

```powershell
$env:Path = "$env:USERPROFILE\.foundry\bin;$env:Path"
anvil --host 0.0.0.0 --port 8545 --no-request-size-limit
```

> **`--no-request-size-limit`** is required because the saved state snapshot exceeds Anvil's default 2 MB request body limit.

## Step 2: Load Saved State via RPC

In a **separate terminal** (PowerShell), run:

```powershell
cd C:\Users\ASUS\Downloads\FITE7001_Capstone_Project

# Read the raw hex snapshot, wrap it in a JSON-RPC envelope, POST it to Anvil.
$state = (Get-Content -Raw 'anvil-snapshot-post-redeploy-2026-04-26T15-28-51.json').Trim()
$body  = '{"jsonrpc":"2.0","method":"anvil_loadState","params":["' + $state + '"],"id":1}'
Invoke-WebRequest -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' `
  -Body ([Text.Encoding]::UTF8.GetBytes($body)) -UseBasicParsing | Select-Object -ExpandProperty Content
```

> Replace the filename with the latest `anvil-snapshot-*.json` in the project root if a newer one exists.

> **Why PowerShell instead of Node?** The snapshot is ~5 MB and Node's `fetch` (and `http.request`) on Windows can hit `connect ETIMEDOUT 127.0.0.1:8545` even when Anvil is listening — this is Node's `autoSelectFamily` happy-eyeballs path misbehaving on some Windows configurations. PowerShell's `Invoke-WebRequest` uses the OS HTTP stack directly and is unaffected. If you prefer Node, see the workarounds at the bottom of this doc.

> **About the file format.** The snapshot files in this repo store the **raw hex blob** produced by `anvil_dumpState` (no surrounding JSON quotes). The `'"' + $state + '"'` wrapping above turns it into a valid JSON string for the `params` array. Do **not** wrap a read of this file in `JSON.parse` — it will fail with `Unexpected non-whitespace character after JSON at position 1`.

Expected output:

```json
{"jsonrpc":"2.0","id":1,"result":true}
```

## Step 2b: Fix Clock (Required)

The saved state contains blocks with future timestamps (due to governance fast-forwarding during testing). After loading, Anvil's wall clock is behind those timestamps, which causes `getPastVotes()` to return 0 — breaking proposal creation and voting.

Run this PowerShell-only snippet to advance the clock past the loaded state's latest block:

```powershell
function Invoke-Rpc($method, $params) {
  $body = @{ jsonrpc = '2.0'; method = $method; params = $params; id = 1 } | ConvertTo-Json -Compress -Depth 5
  (Invoke-WebRequest -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' `
    -Body ([Text.Encoding]::UTF8.GetBytes($body)) -UseBasicParsing).Content | ConvertFrom-Json
}

$latest    = (Invoke-Rpc 'eth_getBlockByNumber' @('latest', $false)).result
$blockTs   = [Convert]::ToInt64($latest.timestamp, 16)
$nowTs     = [int][double]::Parse((Get-Date -UFormat %s))
$target    = [Math]::Max($blockTs, $nowTs) + 172800   # +2 days

Invoke-Rpc 'evm_setNextBlockTimestamp' @('0x' + $target.ToString('x')) | Out-Null
Invoke-Rpc 'evm_mine' @() | Out-Null

$after     = (Invoke-Rpc 'eth_getBlockByNumber' @('latest', $false)).result
$afterTs   = [Convert]::ToInt64($after.timestamp, 16)
$afterNum  = [Convert]::ToInt64($after.number, 16)
"Clock fixed. Block $afterNum at $((Get-Date '1970-01-01').AddSeconds($afterTs).ToString('o'))"
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

These formats are **not interchangeable**. The snapshot files in the project root (e.g. `anvil-snapshot-post-redeploy-2026-04-26T15-28-51.json`) were created via `anvil_dumpState` RPC, so they **must** be loaded via `anvil_loadState` RPC — not `--load-state`.

### Saving a New Snapshot

```powershell
$resp = Invoke-WebRequest -Uri http://127.0.0.1:8545 -Method Post -ContentType 'application/json' `
  -Body '{"jsonrpc":"2.0","method":"anvil_dumpState","params":[],"id":1}' -UseBasicParsing
$json = $resp.Content | ConvertFrom-Json
$ts   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss")
$file = "anvil-snapshot-$ts.json"
Set-Content -Path $file -Value $json.result -NoNewline -Encoding ascii
"Wrote $file ($((Get-Item $file).Length) bytes)"
```

> **Never overwrite existing snapshot files** — always use timestamped filenames. The `Set-Content -NoNewline -Encoding ascii` matters: `anvil_loadState` later expects the raw hex blob with no trailing newline and no BOM.

### Node-based fallbacks (if PowerShell isn't available)

Node's `fetch` / `http.request` on Windows can fail with `connect ETIMEDOUT 127.0.0.1:8545` even when Anvil is listening (autoSelectFamily / IPv6 happy-eyeballs issue, fixed in some Node patch versions). If you must use Node, pick one:

1. **Disable happy-eyeballs for the process:**

   ```powershell
   node --no-network-family-autoselection -e "<your loader script>"
   ```

2. **Force IPv4 in the request options** (using `http.request` instead of `fetch`):

   ```js
   const req = http.request(
     { host: '127.0.0.1', port: 8545, method: 'POST', path: '/', family: 4,
       autoSelectFamily: false,
       headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
     res => { /* ... */ }
   );
   ```

3. **Use `localhost` instead of `127.0.0.1`** — sometimes works because the lookup path differs.

## Environment Summary

| Component | URL | Chain ID |
|-----------|-----|----------|
| Anvil RPC | http://127.0.0.1:8545 | 31337 |
| Frontend (Vite) | http://localhost:3000 | — |
