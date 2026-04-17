## 1. Inside the Codespace terminal — start the blockchain
npx hardhat node

## 2. Start a new terminal, Deploy all contracts + auto-update frontend addresses
start a new terminal then run below code

npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

## 3. Start a new terminal, Start the frontend
start a new terminal then run below code

cd frontend && npm run dev

## 4. For the port forward tab in the bottom panel of VSCode, make both port 8545 and 3000 from private to public

## 5. (Latest Procedure) You just open the Codespace and everything is ready. No commands needed.

If you ever need to start fresh (wipe all data), delete the state file first:

rm .devcontainer/anvil-state.json
bash .devcontainer/start.sh

## 6. Create ETH for Account 

curl -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"anvil_setBalance","params":["0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73","0xD3C21BCECCEDA1000000"],"id":1}'

That sets the Admin account to 1,000,000 ETH instantly. Works for any address — just replace the first param:

Account	Address
Admin	0xFE3B557E8Fb62b89F4916B721be55cEb828dBd73
Operator	0x627306090abaB3A6e1400e9345bC60c78a8BEf57
Agent	0xf17f52151EbEF6C7334FAD080c5704D77216b732
Investor2	0xC5fdf4076b8F3A5357c5E395ab970B5B54098Fef
Investor3	0x821aEa9a577a9b44299B9c15c88cf3087F3b5544
The hex 0xD3C21BCECCEDA1000000 = 1M ETH in wei. This is an Anvil cheat code — it sets the balance directly without needing a transaction. The balance will persist across restarts since start.sh also re-funds all dev accounts automatically on each boot.
