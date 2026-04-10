<# 
  start-besu.ps1 — Start a single-node Hyperledger Besu devnet via Docker
  
  Usage:
    .\besu\start-besu.ps1          # Start in foreground
    .\besu\start-besu.ps1 -Detach  # Start in background (detached)
  
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

# Stop & remove existing container if running
docker rm -f $containerName 2>$null

$detachFlag = if ($Detach) { "-d" } else { "" }

Write-Host "Starting Hyperledger Besu dev node (chain ID 7001)..." -ForegroundColor Cyan
Write-Host "  RPC  : http://127.0.0.1:$rpcPort" -ForegroundColor Green
Write-Host "  WS   : ws://127.0.0.1:$wsPort" -ForegroundColor Green

docker run $detachFlag `
    --name $containerName `
    -p "${rpcPort}:8545" `
    -p "${wsPort}:8546" `
    -v "${genesisPath}:/opt/besu/genesis.json" `
    hyperledger/besu:latest `
    --genesis-file=/opt/besu/genesis.json `
    --network-id=7001 `
    --rpc-http-enabled `
    --rpc-http-api=ETH,NET,WEB3,DEBUG,ADMIN,CLIQUE,MINER,TXPOOL `
    --rpc-http-cors-origins="*" `
    --rpc-http-host=0.0.0.0 `
    --rpc-ws-enabled `
    --rpc-ws-api=ETH,NET,WEB3 `
    --rpc-ws-host=0.0.0.0 `
    --host-allowlist="*" `
    --min-gas-price=0 `
    --miner-enabled `
    --miner-coinbase=0xfe3b557e8fb62b89f4916b721be55ceb828dbd73 `
    --logging=INFO

if ($Detach) {
    Write-Host ""
    Write-Host "Besu node started in background. Container: $containerName" -ForegroundColor Yellow
    Write-Host "Logs:   docker logs -f $containerName" -ForegroundColor Gray
    Write-Host "Stop:   docker stop $containerName && docker rm $containerName" -ForegroundColor Gray
}
