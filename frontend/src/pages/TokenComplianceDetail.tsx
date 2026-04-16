import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { Shield, Clock, ArrowLeft, RefreshCw, Loader2, Trash2 } from 'lucide-react';
import { ethers } from 'ethers';
import { SECURITY_TOKEN_ABI } from '../config/contracts';

interface CapEntry {
  investor: string;
  cap: bigint;
}

interface LockUpEntry {
  investor: string;
  lockUpEnd: bigint;
}

const TokenComplianceDetail: React.FC = () => {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const { contracts } = useWeb3();

  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [globalCap, setGlobalCap] = useState<bigint>(0n);
  const [investorCaps, setInvestorCaps] = useState<CapEntry[]>([]);
  const [lockUps, setLockUps] = useState<LockUpEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState('');

  const loadDetails = useCallback(async () => {
    if (!contracts || !address) return;
    setLoading(true);
    try {
      // Read token name & symbol
      const provider = (contracts.securityToken as any).runner?.provider ?? contracts.securityToken.runner;
      const tok = new ethers.Contract(address, SECURITY_TOKEN_ABI, provider);
      const [name, symbol] = await Promise.all([tok.name(), tok.symbol()]);
      setTokenName(name);
      setTokenSymbol(symbol);

      // Read global cap for this token
      const gCap = await contracts.compliance.globalConcentrationCap(address);
      setGlobalCap(gCap);

      // Discover per-investor concentration caps from events
      const capFilter = contracts.compliance.filters.ConcentrationCapSet(address);
      const capEvents = await contracts.compliance.queryFilter(capFilter, 0, 'latest');

      // Deduplicate: keep latest cap per investor
      const capMap = new Map<string, bigint>();
      for (const ev of capEvents) {
        const args = (ev as any).args;
        if (args) {
          const investor = args[1] as string;
          capMap.set(investor.toLowerCase(), args[2] as bigint);
        }
      }
      // Read current on-chain values (events may be stale if cap was reset to 0)
      const capEntries: CapEntry[] = [];
      for (const [inv] of capMap) {
        const cap = await contracts.compliance.concentrationCap(address, inv);
        if (cap > 0n) {
          capEntries.push({ investor: inv, cap });
        }
      }
      setInvestorCaps(capEntries);

      // Discover lock-up entries from events
      const lockFilter = contracts.compliance.filters.LockUpSet(address);
      const lockEvents = await contracts.compliance.queryFilter(lockFilter, 0, 'latest');

      const lockMap = new Map<string, bigint>();
      for (const ev of lockEvents) {
        const args = (ev as any).args;
        if (args) {
          const investor = args[1] as string;
          lockMap.set(investor.toLowerCase(), args[2] as bigint);
        }
      }
      const lockEntries: LockUpEntry[] = [];
      for (const [inv] of lockMap) {
        const end = await contracts.compliance.lockUpEnd(address, inv);
        if (end > 0n) {
          lockEntries.push({ investor: inv, lockUpEnd: end });
        }
      }
      setLockUps(lockEntries);
    } catch (e) {
      console.error('Failed to load token compliance details:', e);
    } finally {
      setLoading(false);
    }
  }, [contracts, address]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  const fmtTokens = (val: bigint) => Number(ethers.formatUnits(val, 18)).toLocaleString();
  const fmtDate = (ts: bigint) => {
    const d = new Date(Number(ts) * 1000);
    return d.toLocaleString();
  };
  const now = BigInt(Math.floor(Date.now() / 1000));

  const handleRemoveCap = async (investor: string) => {
    if (!contracts || !address) return;
    setRemoving(`cap-${investor}`);
    try {
      const tx = await contracts.compliance.setConcentrationCap(address, investor, 0);
      await tx.wait();
      setInvestorCaps(prev => prev.filter(e => e.investor !== investor));
    } catch (e) {
      console.error('Failed to remove cap:', e);
    } finally {
      setRemoving('');
    }
  };

  const handleRemoveLockUp = async (investor: string) => {
    if (!contracts || !address) return;
    setRemoving(`lock-${investor}`);
    try {
      const tx = await contracts.compliance.setLockUp(address, investor, 0);
      await tx.wait();
      setLockUps(prev => prev.filter(e => e.investor !== investor));
    } catch (e) {
      console.error('Failed to remove lock-up:', e);
    } finally {
      setRemoving('');
    }
  };

  const handleRemoveGlobalCap = async () => {
    if (!contracts || !address) return;
    setRemoving('global');
    try {
      const tx = await contracts.compliance.setGlobalConcentrationCap(address, 0);
      await tx.wait();
      setGlobalCap(0n);
    } catch (e) {
      console.error('Failed to remove global cap:', e);
    } finally {
      setRemoving('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center gap-4">
        <button onClick={() => navigate('/compliance')} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-gray-400" />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-white">
            {tokenSymbol || 'Token'} Compliance Detail
          </h2>
          <p className="text-gray-400 text-sm font-mono truncate">{address}</p>
          {tokenName && <p className="text-gray-500 text-xs">{tokenName}</p>}
        </div>
        <button onClick={loadDetails} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          {loading ? <Loader2 size={18} className="text-gray-400 animate-spin" /> : <RefreshCw size={18} className="text-gray-400" />}
        </button>
      </header>

      {/* Global Cap Card */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={20} className="text-amber-400" />
          <h3 className="font-bold text-white">Global Concentration Cap</h3>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-2xl font-bold text-white">
            {globalCap === 0n ? 'No cap set' : `${fmtTokens(globalCap)} tokens`}
          </p>
          {globalCap > 0n && (
            <button
              onClick={handleRemoveGlobalCap}
              disabled={removing === 'global'}
              className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {removing === 'global' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Per-Investor Concentration Caps */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={20} className="text-amber-400" />
          <h3 className="font-bold text-white">Per-Investor Concentration Caps</h3>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : investorCaps.length === 0 ? (
          <p className="text-gray-500 text-sm">No per-investor caps configured for this token.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-white/10">
                  <th className="pb-2 pr-4">Investor</th>
                  <th className="pb-2 text-right">Max Balance</th>
                  <th className="pb-2 text-right w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {investorCaps.map((entry) => (
                  <tr key={entry.investor} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-4 font-mono text-white text-xs">{entry.investor}</td>
                    <td className="py-2 text-right text-white">{fmtTokens(entry.cap)} tokens</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleRemoveCap(entry.investor)}
                        disabled={removing === `cap-${entry.investor}`}
                        className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                        title="Remove cap"
                      >
                        {removing === `cap-${entry.investor}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Lock-Up Periods */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={20} className="text-pink-400" />
          <h3 className="font-bold text-white">Lock-Up Periods</h3>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-gray-400 text-sm">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : lockUps.length === 0 ? (
          <p className="text-gray-500 text-sm">No lock-up periods configured for this token.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-white/10">
                  <th className="pb-2 pr-4">Investor</th>
                  <th className="pb-2">Lock-Up End</th>
                  <th className="pb-2 text-center">Status</th>
                  <th className="pb-2 text-right w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {lockUps.map((entry) => (
                  <tr key={entry.investor} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-4 font-mono text-white text-xs">{entry.investor}</td>
                    <td className="py-2 text-white">{fmtDate(entry.lockUpEnd)}</td>
                    <td className="py-2 text-center">
                      {entry.lockUpEnd > now ? (
                        <span className="text-xs font-medium px-2 py-1 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                          Locked
                        </span>
                      ) : (
                        <span className="text-xs font-medium px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          Unlocked
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => handleRemoveLockUp(entry.investor)}
                        disabled={removing === `lock-${entry.investor}`}
                        className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                        title="Remove lock-up"
                      >
                        {removing === `lock-${entry.investor}` ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenComplianceDetail;
