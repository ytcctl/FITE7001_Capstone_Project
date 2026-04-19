import React, { useState } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { SECURITY_TOKEN_ABI } from '../config/contracts';
import { ethers } from 'ethers';
import { Snowflake, Search, Loader2, CheckCircle, XCircle } from 'lucide-react';

interface TokenFreezeStatus { name: string; symbol: string; address: string; frozen: boolean }

const FreezeManagement: React.FC = () => {
  const { contracts } = useWeb3();

  // Freeze / Unfreeze
  const [targetAddress, setTargetAddress] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState('');

  // Lookup
  const [lookupAddress, setLookupAddress] = useState('');
  const [lookupResult, setLookupResult] = useState<null | { frozen: boolean }>(null);
  const [lookupDetails, setLookupDetails] = useState<TokenFreezeStatus[]>([]);
  const [isLooking, setIsLooking] = useState(false);

  /** Collect all token contracts (default + V1 factory + V2 factory). */
  const getAllTokenContracts = async (): Promise<{ name: string; symbol: string; address: string; contract: ethers.Contract }[]> => {
    if (!contracts) return [];
    const signer = (contracts.securityToken as any).runner as ethers.Signer;
    const defaultAddr = await contracts.securityToken.getAddress();
    const defaultSym = await contracts.securityToken.symbol().catch(() => 'HKSAT');
    const defaultName = await contracts.securityToken.name().catch(() => 'Default Token');
    const tokens: { name: string; symbol: string; address: string; contract: ethers.Contract }[] = [
      { name: defaultName, symbol: defaultSym, address: defaultAddr, contract: contracts.securityToken },
    ];
    const seen = new Set<string>([defaultAddr.toLowerCase()]);

    // V1 factory tokens
    try {
      const v1Tokens = await contracts.tokenFactory.allTokens();
      for (const t of v1Tokens) {
        const a = (t.tokenAddress as string).toLowerCase();
        if (seen.has(a) || !t.active) continue;
        seen.add(a);
        tokens.push({ name: t.name, symbol: t.symbol, address: t.tokenAddress, contract: new ethers.Contract(t.tokenAddress, SECURITY_TOKEN_ABI, signer) });
      }
    } catch { /* V1 factory not available */ }

    // V2 factory tokens
    try {
      const v2Tokens = await contracts.tokenFactoryV2.allTokens();
      for (const t of v2Tokens) {
        const a = (t.proxyAddress as string).toLowerCase();
        if (seen.has(a) || !t.active) continue;
        seen.add(a);
        tokens.push({ name: t.name, symbol: t.symbol, address: t.proxyAddress, contract: new ethers.Contract(t.proxyAddress, SECURITY_TOKEN_ABI, signer) });
      }
    } catch { /* V2 factory not available */ }

    return tokens;
  };

  const handleFreeze = async (freeze: boolean) => {
    if (!contracts || !targetAddress) return;
    let addr: string;
    try { addr = ethers.getAddress(targetAddress.trim()); } catch { setTxStatus('✗ Invalid Ethereum address'); return; }
    setIsSubmitting(true);
    setTxStatus(freeze ? 'Freezing address on all tokens…' : 'Unfreezing address on all tokens…');
    try {
      const allTokens = await getAllTokenContracts();
      const results: string[] = [];
      let anyFailed = false;
      for (const tok of allTokens) {
        try {
          const tx = await tok.contract.setAddressFrozen(addr, freeze);
          await tx.wait();
          results.push(`✓ ${tok.symbol}`);
        } catch (e: any) {
          anyFailed = true;
          results.push(`✗ ${tok.symbol}: ${e?.reason || 'failed'}`);
        }
      }
      const summary = results.join('  •  ');
      setTxStatus(`${anyFailed ? '⚠' : '✓'} ${freeze ? 'Frozen' : 'Unfrozen'} on ${allTokens.length} token(s): ${summary}`);
      setTargetAddress('');
      // Refresh lookup if it matches
      if (lookupResult && lookupAddress.trim().toLowerCase() === addr.toLowerCase()) {
        setLookupResult({ frozen: freeze });
        setLookupDetails(allTokens.map(t => ({ name: t.name, symbol: t.symbol, address: t.address, frozen: freeze })));
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
      const allTokens = await getAllTokenContracts();
      const details: TokenFreezeStatus[] = [];
      let anyFrozen = false;
      for (const tok of allTokens) {
        try {
          const f = await tok.contract.frozen(addr);
          details.push({ name: tok.name, symbol: tok.symbol, address: tok.address, frozen: !!f });
          if (f) anyFrozen = true;
        } catch {
          details.push({ name: tok.name, symbol: tok.symbol, address: tok.address, frozen: false });
        }
      }
      setLookupResult({ frozen: anyFrozen });
      setLookupDetails(details);
    } catch (e: any) {
      setTxStatus(`✗ Lookup failed: ${e?.reason || e?.message || 'Error'}`);
      setLookupResult(null);
      setLookupDetails([]);
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
          <div className="mt-2 space-y-2">
            <div className="flex items-center gap-3">
              {lookupResult.frozen ? (
                <>
                  <XCircle className="text-red-400" size={20} />
                  <span className="text-red-400 font-medium">Address is FROZEN on one or more tokens</span>
                </>
              ) : (
                <>
                  <CheckCircle className="text-emerald-400" size={20} />
                  <span className="text-emerald-400 font-medium">Address is NOT frozen on any token</span>
                </>
              )}
            </div>
            {lookupDetails.length > 1 && (
              <div className="ml-7 space-y-1">
                {lookupDetails.map(d => (
                  <div key={d.address} className="flex items-center gap-2 text-sm">
                    {d.frozen
                      ? <XCircle className="text-red-400 shrink-0" size={14} />
                      : <CheckCircle className="text-emerald-400 shrink-0" size={14} />}
                    <span className={d.frozen ? 'text-red-400' : 'text-gray-400'}>
                      {d.symbol} — {d.frozen ? 'FROZEN' : 'Not frozen'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FreezeManagement;
