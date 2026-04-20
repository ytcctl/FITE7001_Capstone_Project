import React, { useState } from 'react';
import { ethers } from 'ethers';
import { Fuel, Loader2 } from 'lucide-react';
import { rpcUrlForBrowser } from '../config/contracts';

const MintETH: React.FC = () => {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleMint = async () => {
    setStatus('');
    if (!recipient.trim() || !amount.trim()) {
      setStatus('✗ Please enter both recipient address and amount.');
      return;
    }

    let addr: string;
    try {
      addr = ethers.getAddress(recipient.trim());
    } catch {
      setStatus('✗ Invalid Ethereum address.');
      return;
    }

    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      setStatus('✗ Amount must be a positive number.');
      return;
    }

    setIsSubmitting(true);
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrlForBrowser());
      const balanceBefore = await provider.getBalance(addr);

      // anvil_setBalance sets the absolute balance, so add to current
      const newBalance = balanceBefore + ethers.parseEther(amount.trim());
      await provider.send('anvil_setBalance', [addr, ethers.toQuantity(newBalance)]);

      const balanceAfter = await provider.getBalance(addr);
      setStatus(
        `✓ Minted ${amount} ETH to ${addr.slice(0, 6)}…${addr.slice(-4)}. ` +
        `Balance: ${Number(ethers.formatEther(balanceBefore)).toLocaleString()} → ${Number(ethers.formatEther(balanceAfter)).toLocaleString()} ETH`
      );
      setAmount('');
    } catch (e: any) {
      setStatus(`✗ ${e?.message || 'Mint failed — is Anvil running?'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Fuel className="text-yellow-400" size={28} />
        <h1 className="text-2xl font-bold text-white">Minting ETH for Testing</h1>
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4 max-w-lg">
        <p className="text-gray-400 text-sm">
          Mint test ETH to any address on the local Anvil devnet. This uses <code className="text-yellow-400">anvil_setBalance</code> to credit the recipient.
        </p>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Recipient Address</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Amount (ETH)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 100"
            min="0"
            step="any"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-yellow-500/40"
          />
        </div>

        <button
          onClick={handleMint}
          disabled={isSubmitting}
          className="w-full bg-yellow-600 hover:bg-yellow-500 text-white font-semibold py-2 px-4 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Fuel size={16} />}
          {isSubmitting ? 'Minting…' : 'Mint ETH'}
        </button>

        {status && (
          <p className={`text-sm ${status.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
};

export default MintETH;
