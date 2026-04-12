<# 
  start-besu.ps1 — Start a single-node Hyperledger Besu devnet via Docker
  
  This uses a custom genesis (Cancun EVM at block 0) with the Engine API
  exposed so that block-producer.js can forge blocks on demand.

  Chain data is persisted to besu/data/ so that contracts, state, and
  balances survive container restarts.

  Usage:
    .\besu\start-besu.ps1          # Start in foreground
    .\besu\start-besu.ps1 -Detach  # Start in background (detached)
    .\besu\start-besu.ps1 -Reset   # Wipe chain data and start fresh
  
  After starting Besu, launch the block producer in another terminal:
    node besu\block-producer.js --interval 1000

  Stop:
    docker stop tokenhub-besu
  
  Remove container (data is preserved on disk):
    docker rm tokenhub-besu
#>

param(
    [switch]$Detach,
    [switch]$Reset
)

$containerName = "tokenhub-besu"
$genesisPath   = "$PSScriptRoot\genesis.json"
$dataPath      = "$PSScriptRoot\data"
$rpcPort       = 8545
$wsPort        = 8546
$enginePort    = 8551

# Optionally wipe chain data for a fresh start
if ($Reset) {
    Write-Host "Resetting chain data (wiping $dataPath)..." -ForegroundColor Red
    docker rm -f $containerName 2>$null
    if (Test-Path $dataPath) { Remove-Item -Recurse -Force $dataPath }
    Write-Host "     Chain data wiped. Starting fresh." -ForegroundColor Yellow
}

# Create data directory if it doesn't exist
if (!(Test-Path $dataPath)) { New-Item -ItemType Directory -Path $dataPath -Force | Out-Null }

# Stop & remove existing container if running
docker rm -f $containerName 2>$null

# Convert Windows paths to Docker-compatible format (forward slashes)
$genesisDocker = $genesisPath -replace '\\','/'
$dataDocker    = $dataPath    -replace '\\','/'

Write-Host "Starting Hyperledger Besu (Cancun, chain ID 7001)..." -ForegroundColor Cyan
Write-Host "  RPC    : http://127.0.0.1:$rpcPort" -ForegroundColor Green
Write-Host "  WS     : ws://127.0.0.1:$wsPort" -ForegroundColor Green
Write-Host "  Engine : http://127.0.0.1:$enginePort" -ForegroundColor Green
Write-Host "  Data   : $dataPath" -ForegroundColor Green

# Build argument list (avoids empty-string issues with $detachFlag)
$dockerArgs = @(
    "run"
)
if ($Detach) { $dockerArgs += "-d" }
$dockerArgs += @(
    "--name", $containerName,
    "-p", "${rpcPort}:8545",
    "-p", "${wsPort}:8546",
    "-p", "${enginePort}:8551",
    "-v", "${genesisDocker}:/opt/besu/genesis.json",
    "-v", "${dataDocker}:/opt/besu/data",
    "hyperledger/besu:latest",
    "--genesis-file=/opt/besu/genesis.json",
    "--data-path=/opt/besu/data",
    "--rpc-http-enabled",
    "--rpc-http-api=ETH,NET,WEB3,DEBUG,ADMIN,TXPOOL",
    "--rpc-http-cors-origins=*",
    "--rpc-http-host=0.0.0.0",
    "--rpc-ws-enabled",
    "--rpc-ws-api=ETH,NET,WEB3",
    "--rpc-ws-host=0.0.0.0",
    "--host-allowlist=*",
    "--engine-jwt-disabled",
    "--engine-rpc-enabled",
    "--min-gas-price=0",
    "--logging=INFO"
)

& docker @dockerArgs

if ($Detach) {
    Write-Host ""
    Write-Host "Besu node started in background. Container: $containerName" -ForegroundColor Yellow
    Write-Host "Chain data persisted to: $dataPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Now start the block producer:" -ForegroundColor Yellow
    Write-Host "  node besu\block-producer.js --interval 1000" -ForegroundColor White
    Write-Host ""
    Write-Host "Logs:    docker logs -f $containerName" -ForegroundColor Gray
    Write-Host "Stop:    docker stop $containerName" -ForegroundColor Gray
    Write-Host "Restart: docker start $containerName" -ForegroundColor Gray
    Write-Host "Reset:   .\besu\start-besu.ps1 -Detach -Reset" -ForegroundColor Gray
}
