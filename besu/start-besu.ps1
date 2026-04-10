<# 
  start-besu.ps1 — Start a single-node Hyperledger Besu devnet via Docker
  
  This uses a custom genesis (Cancun EVM at block 0) with the Engine API
  exposed so that block-producer.js can forge blocks on demand.

  Usage:
    .\besu\start-besu.ps1          # Start in foreground
    .\besu\start-besu.ps1 -Detach  # Start in background (detached)
  
  After starting Besu, launch the block producer in another terminal:
    node besu\block-producer.js --interval 1000

  Stop:
    docker stop tokenhub-besu
    docker rm   tokenhub-besu
#>

param(
    [switch]$Detach
)

$containerName = "tokenhub-besu"
$genesisPath   = "$PSScriptRoot\genesis.json"
$rpcPort       = 8545
$wsPort        = 8546
$enginePort    = 8551

# Stop & remove existing container if running
docker rm -f $containerName 2>$null

$detachFlag = if ($Detach) { "-d" } else { "" }

Write-Host "Starting Hyperledger Besu (Cancun, chain ID 7001)..." -ForegroundColor Cyan
Write-Host "  RPC    : http://127.0.0.1:$rpcPort" -ForegroundColor Green
Write-Host "  WS     : ws://127.0.0.1:$wsPort" -ForegroundColor Green
Write-Host "  Engine : http://127.0.0.1:$enginePort" -ForegroundColor Green

docker run $detachFlag `
    --name $containerName `
    -p "${rpcPort}:8545" `
    -p "${wsPort}:8546" `
    -p "${enginePort}:8551" `
    -v "${genesisPath}:/opt/besu/genesis.json" `
    hyperledger/besu:latest `
    --genesis-file=/opt/besu/genesis.json `
    --rpc-http-enabled `
    --rpc-http-api=ETH,NET,WEB3,DEBUG,ADMIN,TXPOOL `
    --rpc-http-cors-origins="*" `
    --rpc-http-host=0.0.0.0 `
    --rpc-ws-enabled `
    --rpc-ws-api=ETH,NET,WEB3 `
    --rpc-ws-host=0.0.0.0 `
    --host-allowlist="*" `
    --engine-jwt-disabled `
    --engine-rpc-enabled `
    --min-gas-price=0 `
    --logging=INFO

if ($Detach) {
    Write-Host ""
    Write-Host "Besu node started in background. Container: $containerName" -ForegroundColor Yellow
    Write-Host "Now start the block producer:" -ForegroundColor Yellow
    Write-Host "  node besu\block-producer.js --interval 1000" -ForegroundColor White
    Write-Host ""
    Write-Host "Logs:   docker logs -f $containerName" -ForegroundColor Gray
    Write-Host "Stop:   docker stop $containerName && docker rm $containerName" -ForegroundColor Gray
}
