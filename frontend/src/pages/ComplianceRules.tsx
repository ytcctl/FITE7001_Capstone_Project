import React, { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { Scale, Globe, Shield, Clock, Loader2, RefreshCw } from 'lucide-react';
import { ethers } from 'ethers';

const ComplianceRules: React.FC = () => {
  const { account, contracts } = useWeb3();

  // Jurisdiction
  const [jurCode, setJurCode] = useState('');
  const [jurAllowed, setJurAllowed] = useState(true);
  // Concentration cap
  const [capToken, setCapToken] = useState('');
  const [capAddress, setCapAddress] = useState('');
  const [capAmount, setCapAmount] = useState('');
  const [globalCap, setGlobalCap] = useState('');
  // Token list for dropdown
  const [tokenList, setTokenList] = useState<{name: string; symbol: string; address: string}[]>([]);
  // Lock-up
  const [lockToken, setLockToken] = useState('');
  const [lockAddress, setLockAddress] = useState('');
  const [lockDate, setLockDate] = useState('');
  // Read state
  const [currentGlobalCap, setCurrentGlobalCap] = useState('0');
  const [oracle, setOracle] = useState('');
  const [jurisdictions, setJurisdictions] = useState<Record<string, boolean>>({});

  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Default jurisdiction codes to check + any discovered via events
  const DEFAULT_JURISDICTIONS = ['HK', 'US', 'SG', 'GB', 'CN', 'KP', 'KR', 'JP', 'IR', 'RU'];

  const loadState = async () => {
    if (!contracts) return;
    try {
      const orc = await contracts.compliance.complianceOracle();
      setOracle(orc);

      // Load token list: start with the default security token, then add factory tokens
      const tokens: {name: string; symbol: string; address: string}[] = [];
      try {
        const defaultAddr = await contracts.securityToken.getAddress();
        const [name, symbol] = await Promise.all([
          contracts.securityToken.name(),
          contracts.securityToken.symbol(),
        ]);
        tokens.push({ name, symbol, address: defaultAddr });
      } catch { /* default token not available */ }
      try {
        const v1All = await contracts.tokenFactory.allTokens();
        for (const t of v1All) {
          if (!tokens.some(x => x.address.toLowerCase() === t.tokenAddress.toLowerCase())) {
            tokens.push({ name: t.name, symbol: t.symbol, address: t.tokenAddress });
          }
        }
      } catch { /* V1 factory not available */ }
      try {
        const v2All = await contracts.tokenFactoryV2.allTokens();
        for (const t of v2All) {
          if (!tokens.some(x => x.address.toLowerCase() === t.proxyAddress.toLowerCase())) {
            tokens.push({ name: t.name, symbol: t.symbol, address: t.proxyAddress });
          }
        }
      } catch { /* V2 factory not available */ }
      setTokenList(tokens);

      // Load global cap for selected token (or first token)
      const selectedToken = capToken || (tokens.length > 0 ? tokens[0].address : '');
      if (selectedToken && !capToken && tokens.length > 0) setCapToken(selectedToken);
      if (selectedToken) {
        const gCap = await contracts.compliance.globalConcentrationCap(selectedToken);
        setCurrentGlobalCap(ethers.formatUnits(gCap, 18));
      } else {
        setCurrentGlobalCap('0');
      }

      // Discover additional jurisdictions from on-chain events
      const discoveredCodes = new Set<string>(DEFAULT_JURISDICTIONS);
      try {
        const filter = contracts.compliance.filters.JurisdictionSet();
        const events = await contracts.compliance.queryFilter(filter, 0, 'latest');
        for (const ev of events) {
          try {
            const hexCode = (ev as any).args?.[0] || (ev as any).args?.jurisdiction;
            if (hexCode) {
              const decoded = ethers.decodeBytes32String(hexCode + '0'.repeat(66 - hexCode.length));
              if (decoded && decoded.length === 2) discoveredCodes.add(decoded);
            }
          } catch { /* skip undecoded */ }
        }
      } catch { /* events not supported or no events */ }

      // Query each jurisdiction's status
      const jurMap: Record<string, boolean> = {};
      await Promise.all(
        Array.from(discoveredCodes).map(async (code) => {
          try {
            const b = ethers.encodeBytes32String(code).slice(0, 6);
            jurMap[code] = await contracts.compliance.allowedJurisdictions(b);
          } catch { /* skip */ }
        })
      );
      setJurisdictions(jurMap);
    } catch (e) {
      console.error('Compliance load error:', e);
    }
  };

  useEffect(() => {
    loadState();
  }, [contracts]);

  const handleSetJurisdiction = async () => {
    if (!contracts || !jurCode) return;
    setIsSubmitting(true);
    setTxStatus(`Setting jurisdiction ${jurCode}…`);
    try {
      const code = ethers.encodeBytes32String(jurCode).slice(0, 6);
      const tx = await contracts.compliance.setJurisdiction(code, jurAllowed);
      await tx.wait();
      setTxStatus(`✓ Jurisdiction ${jurCode} ${jurAllowed ? 'allowed' : 'blocked'}`);
      // Immediately reflect the change in the UI before full reload
      setJurisdictions(prev => ({ ...prev, [jurCode]: jurAllowed }));
      loadState();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetConcentrationCap = async () => {
    if (!contracts || !capToken || !capAddress || !capAmount) return;
    setIsSubmitting(true);
    setTxStatus('Setting concentration cap…');
    try {
      const tx = await contracts.compliance.setConcentrationCap(capToken, capAddress, ethers.parseUnits(capAmount, 18));
      await tx.wait();
      setTxStatus(`✓ Concentration cap set to ${capAmount} for ${capAddress.slice(0, 10)}…`);
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetGlobalCap = async () => {
    if (!contracts || !capToken || !globalCap) return;
    setIsSubmitting(true);
    setTxStatus('Setting global concentration cap…');
    try {
      const tx = await contracts.compliance.setGlobalConcentrationCap(capToken, ethers.parseUnits(globalCap, 18));
      await tx.wait();
      setTxStatus(`✓ Global concentration cap set to ${globalCap}`);
      loadState();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetLockUp = async () => {
    if (!contracts || !lockToken || !lockAddress || !lockDate) return;
    setIsSubmitting(true);
    setTxStatus('Setting lock-up…');
    try {
      const endTime = Math.floor(new Date(lockDate).getTime() / 1000);
      const tx = await contracts.compliance.setLockUp(lockToken, lockAddress, endTime);
      await tx.wait();
      setTxStatus(`✓ Lock-up set for ${lockAddress.slice(0, 10)}… until ${lockDate}`);
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <Scale size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Compliance Rules</h2>
        <p className="text-gray-400">Connect your wallet to manage compliance modules.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Compliance Rules</h2>
          <p className="text-gray-400">Manage jurisdiction whitelist, concentration caps, and lock-up periods.</p>
        </div>
        <button onClick={loadState} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          <RefreshCw size={18} className="text-gray-400" />
        </button>
      </header>

      {txStatus && (
        <div
          className={`glass-card px-4 py-3 text-sm font-medium ${
            txStatus.startsWith('✓') ? 'text-emerald-400' : txStatus.startsWith('✗') ? 'text-red-400' : 'text-purple-300'
          }`}
        >
          {txStatus}
        </div>
      )}

      {/* Current State */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6">
          <p className="text-sm text-gray-400 mb-1">Compliance Oracle</p>
          <p className="text-sm font-mono text-white truncate">{oracle || '—'}</p>
        </div>
        <div className="glass-card p-6">
          <p className="text-sm text-gray-400 mb-1">Global Cap {capToken ? `(${tokenList.find(t => t.address === capToken)?.symbol || 'selected token'})` : ''}</p>
          <p className="text-xl font-bold text-white">
            {Number(currentGlobalCap) === 0 ? 'No cap' : `${Number(currentGlobalCap).toLocaleString()} tokens`}
          </p>
        </div>
        <div className="glass-card p-6">
          <p className="text-sm text-gray-400 mb-1">Jurisdictions</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {Object.keys(jurisdictions).length === 0 ? (
              <span className="text-xs text-gray-500">Loading…</span>
            ) : (
              Object.entries(jurisdictions)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([code, allowed]) => (
                  <span
                    key={code}
                    className={`text-xs font-medium px-2 py-1 rounded-full border ${
                      allowed
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : 'bg-red-500/20 text-red-400 border-red-500/30'
                    }`}
                  >
                    {code} {allowed ? '✓' : '✗'}
                  </span>
                ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Jurisdiction */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe size={20} className="text-cyan-400" />
            <h3 className="font-bold text-white">Jurisdiction Whitelist</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Country Code</label>
              <input
                type="text"
                value={jurCode}
                onChange={(e) => setJurCode(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="US"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="radio" checked={jurAllowed} onChange={() => setJurAllowed(true)} className="accent-emerald-500" />
                Allow
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input type="radio" checked={!jurAllowed} onChange={() => setJurAllowed(false)} className="accent-red-500" />
                Block
              </label>
            </div>
            <button onClick={handleSetJurisdiction} disabled={isSubmitting || !jurCode} className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              Update Jurisdiction
            </button>
          </div>
        </div>

        {/* Concentration Cap */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={20} className="text-amber-400" />
            <h3 className="font-bold text-white">Concentration Caps</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Token</label>
              <select
                value={capToken}
                onChange={async (e) => {
                  setCapToken(e.target.value);
                  if (contracts && e.target.value) {
                    try {
                      const gCap = await contracts.compliance.globalConcentrationCap(e.target.value);
                      setCurrentGlobalCap(ethers.formatUnits(gCap, 18));
                    } catch { setCurrentGlobalCap('0'); }
                  }
                }}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              >
                <option value="" className="bg-gray-900">Select a token…</option>
                {tokenList.map((t) => (
                  <option key={t.address} value={t.address} className="bg-gray-900">
                    {t.symbol} — {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Investor Address</label>
              <input type="text" value={capAddress} onChange={(e) => setCapAddress(e.target.value)} placeholder="0x…" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Max Balance (tokens)</label>
              <input type="text" value={capAmount} onChange={(e) => setCapAmount(e.target.value)} placeholder="10000" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
            </div>
            <button onClick={handleSetConcentrationCap} disabled={isSubmitting || !capToken || !capAddress || !capAmount} className="w-full bg-gradient-to-r from-amber-600 to-orange-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              Set Per-Investor Cap
            </button>
            <div className="border-t border-white/10 pt-3 mt-3">
              <label className="block text-sm text-gray-400 mb-1">Global Cap (tokens)</label>
              <div className="flex gap-2">
                <input type="text" value={globalCap} onChange={(e) => setGlobalCap(e.target.value)} placeholder="100000" className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
                <button onClick={handleSetGlobalCap} disabled={isSubmitting || !capToken || !globalCap} className="bg-white/10 hover:bg-white/15 border border-white/10 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50">
                  Set
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Lock-Up */}
        <div className="glass-card p-6 lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={20} className="text-pink-400" />
            <h3 className="font-bold text-white">Lock-Up Period</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Token</label>
              <select
                value={lockToken}
                onChange={(e) => setLockToken(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              >
                <option value="" className="bg-gray-900">Select a token…</option>
                {tokenList.map((t) => (
                  <option key={t.address} value={t.address} className="bg-gray-900">
                    {t.symbol} — {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Investor Address</label>
              <input type="text" value={lockAddress} onChange={(e) => setLockAddress(e.target.value)} placeholder="0x…" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Lock-Up End Date</label>
              <input type="datetime-local" value={lockDate} onChange={(e) => setLockDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={handleSetLockUp} disabled={isSubmitting || !lockToken || !lockAddress || !lockDate} className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                Set Lock-Up
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComplianceRules;
