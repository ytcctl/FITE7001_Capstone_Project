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


## 7 Registered and verify new account by command
cd /workspaces/FITE7001_Capstone_Project && ADDR="0xPUT_ADDRESS_HERE" node -e "
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
const admin = new ethers.Wallet('0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63', provider);
const registryAddr = '0x42699A7612A82f1d9C36148af9C77354759b210b';
const ciAddr = '0xfeae27388A65eE984F452f86efFEd42AaBD438FD';
const registry = new ethers.Contract(registryAddr, [
  'function registerIdentity(address,address,string) external',
  'function setClaim(address,uint256,bool) external',
  'function issueClaim(address,uint256,address,bytes,bytes) external',
  'function isVerified(address) view returns (bool)',
  'function contains(address) view returns (bool)',
  'function identity(address) view returns (address)',
], admin);
const ci = new ethers.Contract(ciAddr, [
  'function getClaimHash(address,uint256,bytes) view returns (bytes32)',
], provider);
const addr = process.env.ADDR;
(async () => {
  let nonce = await provider.getTransactionCount(admin.address, 'latest');
  // Step 1: Register
  if (await registry.contains(addr)) { console.log('Already registered'); }
  else { await (await registry.registerIdentity(addr, ethers.ZeroAddress, 'HK', {nonce})).wait(); nonce++; console.log('Registered'); }
  // Step 2: Boolean claims 1-6
  for (const t of [1,2,3,4,5,6]) { await (await registry.setClaim(addr, t, true, {nonce})).wait(); nonce++; }
  console.log('Boolean claims 1-6 set');
  // Step 3: ERC-735 claims 1-5
  const idAddr = await registry.identity(addr);
  if (idAddr !== ethers.ZeroAddress) {
    for (const t of [1,2,3,4,5]) {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(['address','uint256','uint256'], [addr, t, 0]);
      const hash = await ci.getClaimHash(idAddr, t, data);
      const sig = await admin.signMessage(ethers.getBytes(hash));
      await (await registry.issueClaim(addr, t, ciAddr, sig, data, {nonce})).wait(); nonce++;
    }
    console.log('ERC-735 claims 1-5 issued');
  }
  // Verify
  const v = await registry.isVerified(addr);
  console.log(addr, '- isVerified:', v);
})().catch(console.error);
"
