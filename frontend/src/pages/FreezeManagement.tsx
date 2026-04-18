import React, { useState } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { ethers } from 'ethers';
import { Snowflake, Search, Loader2, CheckCircle, XCircle } from 'lucide-react';

const FreezeManagement: React.FC = () => {
  const { contracts } = useWeb3();

  // Freeze / Unfreeze
  const [targetAddress, setTargetAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState('');

  // Lookup
  const [lookupAddress, setLookupAddress] = useState('');
  const [lookupResult, setLookupResult] = useState<null | { frozen: boolean }>(null);
  const [isLooking, setIsLooking] = useState(false);

  const handleFreeze = async (freeze: boolean) => {
    if (!contracts || !targetAddress) return;
    let addr: string;
    try { addr = ethers.getAddress(targetAddress.trim()); } catch { setTxStatus('✗ Invalid Ethereum address'); return; }
    setIsSubmitting(true);
    setTxStatus(freeze ? 'Freezing address…' : 'Unfreezing address…');
    try {
      const tx = await contracts.securityToken.setAddressFrozen(addr, freeze);
      setTxStatus('Transaction submitted. Waiting for confirmation…');
      await tx.wait();
      setTxStatus(`✓ Address ${freeze ? 'frozen' : 'unfrozen'} successfully.`);
      setTargetAddress('');
      // Refresh lookup if it matches
      if (lookupResult && lookupAddress.trim().toLowerCase() === addr.toLowerCase()) {
        setLookupResult({ frozen: freeze });
      }
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Transaction failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLookup = async () => {
    if (!contracts || !lookupAddress) return;
    let addr: string;
    try { addr = ethers.getAddress(lookupAddress.trim()); } catch { setTxStatus('✗ Invalid lookup address'); return; }
    setIsLooking(true);
    try {
      const frozen = await contracts.securityToken.frozen(addr);
      setLookupResult({ frozen });
    } catch (e: any) {
      setTxStatus(`✗ Lookup failed: ${e?.reason || e?.message || 'Error'}`);
      setLookupResult(null);
    } finally {
      setIsLooking(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Snowflake className="text-blue-400 shrink-0" size={28} />
        <h2 className="text-xl md:text-2xl font-bold text-white">Freeze Management</h2>
      </div>
      <p className="text-gray-400 text-sm -mt-4">
        Freeze or unfreeze investor addresses. A frozen address <strong>cannot send or receive</strong> any tokens until unfrozen.
        Requires <code className="text-purple-300">AGENT_ROLE</code>.
      </p>

      {/* Freeze / Unfreeze Card */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="font-bold text-white text-lg">Freeze / Unfreeze Address</h3>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Wallet Address</label>
          <input
            type="text"
            placeholder="0x…"
            value={targetAddress}
            onChange={e => setTargetAddress(e.target.value)}
            className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => handleFreeze(true)}
            disabled={isSubmitting || !targetAddress}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl font-semibold hover:from-red-500 hover:to-red-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Snowflake size={16} />}
            Freeze
          </button>
          <button
            onClick={() => handleFreeze(false)}
            disabled={isSubmitting || !targetAddress}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-xl font-semibold hover:from-emerald-500 hover:to-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            Unfreeze
          </button>
        </div>

        {txStatus && (
          <p className={`text-sm mt-2 ${txStatus.startsWith('✓') ? 'text-emerald-400' : txStatus.startsWith('✗') ? 'text-red-400' : 'text-purple-300'}`}>
            {txStatus}
          </p>
        )}
      </div>

      {/* Lookup Card */}
      <div className="glass-card p-6 space-y-4">
        <h3 className="font-bold text-white text-lg">Check Frozen Status</h3>

        <div className="flex gap-3">
          <input
            type="text"
            placeholder="0x… address to check"
            value={lookupAddress}
            onChange={e => { setLookupAddress(e.target.value); setLookupResult(null); }}
            className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <button
            onClick={handleLookup}
            disabled={isLooking || !lookupAddress}
            className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-semibold hover:from-purple-500 hover:to-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLooking ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            Lookup
          </button>
        </div>

        {lookupResult && (
          <div className="flex items-center gap-3 mt-2">
            {lookupResult.frozen ? (
              <>
                <XCircle className="text-red-400" size={20} />
                <span className="text-red-400 font-medium">Address is FROZEN — all transfers blocked</span>
              </>
            ) : (
              <>
                <CheckCircle className="text-emerald-400" size={20} />
                <span className="text-emerald-400 font-medium">Address is NOT frozen — transfers allowed</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FreezeManagement;
