# 1. Inside the Codespace terminal — start the blockchain
npx hardhat node

# 2. Deploy all contracts + auto-update frontend addresses
npx hardhat run scripts/deploy-and-update-frontend.js --network localhost

# 3. Start the frontend
cd frontend && npm run dev
