import React, { useState, useCallback, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { SECURITY_TOKEN_ABI } from '../config/contracts';
import { ethers } from 'ethers';
import { Snowflake, Search, Loader2, ChevronDown } from 'lucide-react';

interface TokenOption {
  name: string;
  symbol: string;
  address: string;
}

const FreezeManagement: React.FC = () => {
  const { account, contracts, provider } = useWeb3();

  // Token selector
  const [tokenOptions, setTokenOptions] = useState<TokenOption[]>([]);
  const [selectedTokenAddr, setSelectedTokenAddr] = useState('');
  const [tokenDropdownOpen, setTokenDropdownOpen] = useState(false);
  const [stSymbol, setStSymbol] = useState('');

  // Lookup
  const [lookupAddress, setLookupAddress] = useState('');
  const [lookupResult, setLookupResult] = useState<null | { frozen: boolean; safeListed: boolean }>(null);

  // Freeze / Unfreeze
  const [targetAddress, setTargetAddress] = useState('');
  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTokenAgent, setIsTokenAgent] = useState(false);

  /* ------------------------------------------------------------------ */
  /*  Load available tokens                                              */
  /* ------------------------------------------------------------------ */
  const loadTokens = useCallback(async () => {
    if (!contracts) return;
    const options: TokenOption[] = [];

    try {
      const [name, symbol] = await Promise.all([
        contracts.securityToken.name(),
        contracts.securityToken.symbol(),
      ]);
      const addr = await contracts.securityToken.getAddress();
      options.push({ name, symbol, address: addr });
    } catch { /* default token unavailable */ }

    try {
      const all = await contracts.tokenFactory.allTokens();
      for (const t of all) {
        if (options.find(o => o.address.toLowerCase() === t.tokenAddress.toLowerCase())) continue;
        if (t.active) options.push({ name: t.name, symbol: t.symbol, address: t.tokenAddress });
      }
    } catch { /* factory not deployed */ }

    try {
      const allV2 = await contracts.tokenFactoryV2.allTokens();
      for (const t of allV2) {
        if (options.find(o => o.address.toLowerCase() === t.proxyAddress.toLowerCase())) continue;
        if (t.active) options.push({ name: t.name, symbol: t.symbol, address: t.proxyAddress });
      }
    } catch { /* V2 factory not deployed */ }

    setTokenOptions(options);
    if (options.length > 0 && !selectedTokenAddr) setSelectedTokenAddr(options[0].address);
  }, [contracts, selectedTokenAddr]);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  /* ------------------------------------------------------------------ */
  /*  Load token info + role check when token changes                    */
  /* ------------------------------------------------------------------ */
  const getTokenContract = useCallback(() => {
    if (!contracts || !selectedTokenAddr || !provider) return null;
    if (selectedTokenAddr === (contracts.securityToken as ethers.Contract).target) {
      return contracts.securityToken as ethers.Contract;
    }
    return new ethers.Contract(selectedTokenAddr, SECURITY_TOKEN_ABI, provider);
  }, [contracts, selectedTokenAddr, provider]);

  const loadTokenInfo = useCallback(async () => {
    const tokenContract = getTokenContract();
    if (!tokenContract) return;
    try {
      const sym = await tokenContract.symbol();
      setStSymbol(sym);
    } catch { setStSymbol(''); }

    if (account) {
      try {
        const agentRole = await tokenContract.AGENT_ROLE();
        const adminRole = await tokenContract.DEFAULT_ADMIN_ROLE();
        const [hasAgent, hasAdmin] = await Promise.all([
          tokenContract.hasRole(agentRole, account),
          tokenContract.hasRole(adminRole, account),
        ]);
        setIsTokenAgent(hasAgent || hasAdmin);
      } catch { setIsTokenAgent(false); }
    }
  }, [getTokenContract, account]);

  useEffect(() => { loadTokenInfo(); }, [loadTokenInfo]);

  /* ------------------------------------------------------------------ */
  /*  Lookup address status                                              */
  /* ------------------------------------------------------------------ */
  const handleLookup = async () => {
    if (!lookupAddress) return;
    const tokenContract = getTokenContract();
    if (!tokenContract) return;

    let addr: string;
    try { addr = ethers.getAddress(lookupAddress.trim()); }
    catch { setTxStatus('✗ Invalid Ethereum address'); return; }

    try {
      const [frozen, safeListed] = await Promise.all([
        tokenContract.frozen(addr),
        tokenContract.safeListed(addr),
      ]);
      setLookupResult({ frozen, safeListed });
      setTxStatus('');
    } catch (e: any) {
      setTxStatus(`✗ Lookup failed: ${e?.reason || e?.message || 'unknown error'}`);
      setLookupResult(null);
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Freeze / Unfreeze                                                  */
  /* ------------------------------------------------------------------ */
  const handleFreeze = async (freeze: boolean) => {
    if (!targetAddress || !contracts || !selectedTokenAddr) return;
    let addr: string;
    try { addr = ethers.getAddress(targetAddress.trim()); }
    catch { setTxStatus('✗ Invalid Ethereum address'); return; }

    const signer = await provider!.getSigner();
    const tokenContract = new ethers.Contract(selectedTokenAddr, SECURITY_TOKEN_ABI, signer);

    setIsSubmitting(true);
    setTxStatus(`${freeze ? 'Freezing' : 'Unfreezing'} ${addr.slice(0, 10)}…`);
    try {
      const tx = await tokenContract.setAddressFrozen(addr, freeze);
      await tx.wait();
      setTxStatus(`✓ ${addr.slice(0, 10)}… ${freeze ? 'frozen' : 'unfrozen'} on ${stSymbol}`);
      setTargetAddress('');
      // Refresh lookup if same address
      if (lookupAddress.trim().toLowerCase() === addr.toLowerCase()) {
        const [frozen, safeListed] = await Promise.all([
          tokenContract.frozen(addr),
          tokenContract.safeListed(addr),
        ]);
        setLookupResult({ frozen, safeListed });
      }
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.data?.message || e?.message || 'Transaction failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Selected token label                                               */
  /* ------------------------------------------------------------------ */
  const selectedOption = tokenOptions.find(t => t.address === selectedTokenAddr);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Snowflake className="text-cyan-400" size={28} />
        <h2 className="text-2xl font-bold text-white">Freeze Management</h2>
      </div>

      {/* Token Selector */}
      {tokenOptions.length > 1 && (
        <div className="glass-card p-4 relative">
          <label className="text-xs text-gray-400 mb-1 block">Select Token</label>
          <button
            onClick={() => setTokenDropdownOpen(!tokenDropdownOpen)}
            className="w-full flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white hover:bg-white/10 transition"
          >
            <span>{selectedOption ? `${selectedOption.symbol} — ${selectedOption.name}` : 'Select…'}</span>
            <ChevronDown size={16} />
          </button>
          {tokenDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-900 border border-white/10 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto">
              {tokenOptions.map(t => (
                <button
                  key={t.address}
                  onClick={() => { setSelectedTokenAddr(t.address); setTokenDropdownOpen(false); setLookupResult(null); }}
                  className="w-full text-left px-4 py-2 hover:bg-white/10 text-sm text-gray-200"
                >
                  <span className="font-medium">{t.symbol}</span> — {t.name}
                  <span className="text-gray-500 ml-2 text-xs">{t.address.slice(0, 10)}…</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lookup Card */}
      <div className="glass-card p-6">
        <h3 className="font-bold text-white mb-4 flex items-center gap-2">
          <Search size={18} /> Lookup Address Status
        </h3>
        <div className="flex gap-2 mb-4">
          <input
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 text-sm"
            placeholder="0x… investor address"
            value={lookupAddress}
            onChange={e => setLookupAddress(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
          />
          <button
            onClick={handleLookup}
            className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            Lookup
          </button>
        </div>
        {lookupResult && (
          <div className="grid grid-cols-2 gap-4">
            <div className={`rounded-lg px-4 py-3 text-center text-sm font-medium ${lookupResult.frozen ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
              Frozen: {lookupResult.frozen ? 'Yes' : 'No'}
            </div>
            <div className={`rounded-lg px-4 py-3 text-center text-sm font-medium ${lookupResult.safeListed ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-300'}`}>
              Safe-Listed: {lookupResult.safeListed ? 'Yes' : 'No'}
            </div>
          </div>
        )}
      </div>

      {/* Freeze / Unfreeze Card */}
      <div className="glass-card p-6">
        <h3 className="font-bold text-white mb-2 flex items-center gap-2">
          <Snowflake size={18} /> Freeze / Unfreeze Address
        </h3>
        <p className="text-xs text-gray-400 mb-4">
          Requires <span className="font-mono">AGENT_ROLE</span> on the selected token.
          Frozen addresses cannot send or receive tokens.
        </p>

        {!isTokenAgent && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 text-yellow-300 text-sm mb-4">
            Connected wallet does not have AGENT_ROLE or DEFAULT_ADMIN_ROLE on this token.
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <input
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-gray-500 text-sm"
            placeholder="0x… address to freeze/unfreeze"
            value={targetAddress}
            onChange={e => setTargetAddress(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => handleFreeze(true)}
            disabled={isSubmitting || !targetAddress || !isTokenAgent}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Snowflake size={16} />}
            Freeze
          </button>
          <button
            onClick={() => handleFreeze(false)}
            disabled={isSubmitting || !targetAddress || !isTokenAgent}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : null}
            Unfreeze
          </button>
        </div>

        {/* Transaction status */}
        {txStatus && (
          <p className={`mt-4 text-sm font-medium ${txStatus.startsWith('✓') ? 'text-green-400' : txStatus.startsWith('✗') ? 'text-red-400' : 'text-cyan-300'}`}>
            {txStatus}
          </p>
        )}
      </div>
    </div>
  );
};

export default FreezeManagement;
