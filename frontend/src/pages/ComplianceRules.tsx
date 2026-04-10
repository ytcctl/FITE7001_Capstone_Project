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
  const [capAddress, setCapAddress] = useState('');
  const [capAmount, setCapAmount] = useState('');
  const [globalCap, setGlobalCap] = useState('');
  // Lock-up
  const [lockAddress, setLockAddress] = useState('');
  const [lockDate, setLockDate] = useState('');
  // Read state
  const [currentGlobalCap, setCurrentGlobalCap] = useState('0');
  const [oracle, setOracle] = useState('');
  const [hkAllowed, setHkAllowed] = useState(false);
  const [usAllowed, setUsAllowed] = useState(false);

  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadState = async () => {
    if (!contracts) return;
    try {
      const [gCap, orc, hk, us] = await Promise.all([
        contracts.compliance.globalConcentrationCap(),
        contracts.compliance.complianceOracle(),
        contracts.compliance.allowedJurisdictions(ethers.encodeBytes32String('HK').slice(0, 6)),
        contracts.compliance.allowedJurisdictions(ethers.encodeBytes32String('US').slice(0, 6)),
      ]);
      setCurrentGlobalCap(ethers.formatUnits(gCap, 18));
      setOracle(orc);
      setHkAllowed(hk);
      setUsAllowed(us);
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
      loadState();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetConcentrationCap = async () => {
    if (!contracts || !capAddress || !capAmount) return;
    setIsSubmitting(true);
    setTxStatus('Setting concentration cap…');
    try {
      const tx = await contracts.compliance.setConcentrationCap(capAddress, ethers.parseUnits(capAmount, 18));
      await tx.wait();
      setTxStatus(`✓ Concentration cap set to ${capAmount} for ${capAddress.slice(0, 10)}…`);
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetGlobalCap = async () => {
    if (!contracts || !globalCap) return;
    setIsSubmitting(true);
    setTxStatus('Setting global concentration cap…');
    try {
      const tx = await contracts.compliance.setGlobalConcentrationCap(ethers.parseUnits(globalCap, 18));
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
    if (!contracts || !lockAddress || !lockDate) return;
    setIsSubmitting(true);
    setTxStatus('Setting lock-up…');
    try {
      const endTime = Math.floor(new Date(lockDate).getTime() / 1000);
      const tx = await contracts.compliance.setLockUp(lockAddress, endTime);
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
          <p className="text-sm text-gray-400 mb-1">Global Cap</p>
          <p className="text-xl font-bold text-white">
            {Number(currentGlobalCap) === 0 ? 'No cap' : `${Number(currentGlobalCap).toLocaleString()} tokens`}
          </p>
        </div>
        <div className="glass-card p-6">
          <p className="text-sm text-gray-400 mb-1">Jurisdictions</p>
          <div className="flex gap-3 mt-1">
            <span className={`text-xs font-medium px-2 py-1 rounded-full border ${hkAllowed ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
              HK {hkAllowed ? '✓' : '✗'}
            </span>
            <span className={`text-xs font-medium px-2 py-1 rounded-full border ${usAllowed ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
              US {usAllowed ? '✓' : '✗'}
            </span>
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
              <label className="block text-sm text-gray-400 mb-1">Investor Address</label>
              <input type="text" value={capAddress} onChange={(e) => setCapAddress(e.target.value)} placeholder="0x…" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Max Balance (tokens)</label>
              <input type="text" value={capAmount} onChange={(e) => setCapAmount(e.target.value)} placeholder="10000" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
            </div>
            <button onClick={handleSetConcentrationCap} disabled={isSubmitting || !capAddress || !capAmount} className="w-full bg-gradient-to-r from-amber-600 to-orange-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              Set Per-Investor Cap
            </button>
            <div className="border-t border-white/10 pt-3 mt-3">
              <label className="block text-sm text-gray-400 mb-1">Global Cap (tokens)</label>
              <div className="flex gap-2">
                <input type="text" value={globalCap} onChange={(e) => setGlobalCap(e.target.value)} placeholder="100000" className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
                <button onClick={handleSetGlobalCap} disabled={isSubmitting || !globalCap} className="bg-white/10 hover:bg-white/15 border border-white/10 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Investor Address</label>
              <input type="text" value={lockAddress} onChange={(e) => setLockAddress(e.target.value)} placeholder="0x…" className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Lock-Up End Date</label>
              <input type="datetime-local" value={lockDate} onChange={(e) => setLockDate(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm" />
            </div>
            <div className="flex items-end">
              <button onClick={handleSetLockUp} disabled={isSubmitting || !lockAddress || !lockDate} className="w-full bg-gradient-to-r from-pink-600 to-purple-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
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
