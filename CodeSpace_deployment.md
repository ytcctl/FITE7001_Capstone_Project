## 1. Inside the Codespace terminal — start the blockchain
npx hardhat node

## 2. Start a new terminal, Deploy all contracts + auto-update frontend addresses
start a new terminal then run below code

npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

## 3. Start a new terminal, Start the frontend
start a new terminal then run below code

cd frontend && npm run dev

## 4. For the port forward tab in the bottom panel of VSCode, make both port 8545 and 3000 from private to public
