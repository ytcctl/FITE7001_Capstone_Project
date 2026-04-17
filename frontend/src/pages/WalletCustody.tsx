import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  Vault,
  Shield,
  Flame,
  Thermometer,
  Snowflake,
  AlertTriangle,
  CheckCircle2,
  Plus,
  RefreshCw,
  ArrowRightLeft,
  Clock,
  Users,
  Hash,
} from 'lucide-react';
import { useWeb3 } from '../context/Web3Context';

// Wallet tier enum values matching the contract
const TIER_LABELS: Record<number, string> = {
  0: 'Unregistered',
  1: 'Hot',
  2: 'Warm',
  3: 'Cold',
};

const TIER_COLORS: Record<number, string> = {
  1: 'text-red-400 bg-red-500/10 border-red-500/20',
  2: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  3: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
};

const TIER_ICONS: Record<number, React.ReactNode> = {
  1: <Flame size={16} className="text-red-400" />,
  2: <Thermometer size={16} className="text-yellow-400" />,
  3: <Snowflake size={16} className="text-blue-400" />,
};

interface WalletInfo {
  address: string;
  tier: number;
  label: string;
  registeredAt: number;
  active: boolean;
}

interface TierBreakdown {
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  hotBal: bigint;
  warmBal: bigint;
  coldBal: bigint;
  total: bigint;
  hotCapVal: bigint;
  overCap: boolean;
}

interface MultiSigTx {
  id: number;
  token: string;
  to: string;
  amount: bigint;
  reason: string;
  proposedAt: number;
  executed: boolean;
  cancelled: boolean;
  confirmations: number;
}

interface SweepRecord {
  token: string;
  from: string;
  to: string;
  amount: bigint;
  timestamp: number;
  reason: string;
}

const WalletCustody: React.FC = () => {
  const { contracts, account, roles } = useWeb3();

  // State
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [breakdowns, setBreakdowns] = useState<TierBreakdown[]>([]);
  const [hotCapBps, setHotCapBps] = useState<number>(0);
  const [multiSigTxs, setMultiSigTxs] = useState<MultiSigTx[]>([]);
  const [signers, setSigners] = useState<string[]>([]);
  const [sweepRecords, setSweepRecords] = useState<SweepRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [newWalletAddr, setNewWalletAddr] = useState('');
  const [newWalletTier, setNewWalletTier] = useState(1);
  const [newWalletLabel, setNewWalletLabel] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  // Load data
  const loadData = useCallback(async () => {
    if (!contracts) return;
    setLoading(true);
    setError(null);

    try {
      const wr = contracts.walletRegistry;
      const ms = contracts.multiSigWarm;

      // Fetch wallet list
      const walletList: string[] = await wr.getWalletList();
      const walletInfos: WalletInfo[] = await Promise.all(
        walletList.map(async (addr: string) => {
          const info = await wr.wallets(addr);
          return {
            address: addr,
            tier: Number(info.tier),
            label: info.label,
            registeredAt: Number(info.registeredAt),
            active: info.active,
          };
        })
      );
      setWallets(walletInfos);

      // Fetch tier breakdown for ALL tracked tokens
      try {
        const trackedTokens: string[] = await wr.getTrackedTokens();
        const erc20MinAbi = [
          'function name() view returns (string)',
          'function symbol() view returns (string)',
          'function decimals() view returns (uint8)',
        ];
        const provider = wr.runner?.provider ?? wr.runner;
        const bds: TierBreakdown[] = await Promise.all(
          trackedTokens.map(async (tokenAddr: string) => {
            const bd = await wr.tierBreakdown(tokenAddr);
            let tokenName = tokenAddr.slice(0, 10) + '…';
            let tokenSymbol = '???';
            let decimals = 18;
            try {
              const tok = new ethers.Contract(tokenAddr, erc20MinAbi, provider);
              [tokenName, tokenSymbol, decimals] = await Promise.all([
                tok.name(),
                tok.symbol(),
                tok.decimals().then(Number),
              ]);
            } catch { /* fallback to address */ }
            return {
              tokenAddress: tokenAddr,
              tokenName,
              tokenSymbol,
              decimals,
              hotBal: bd.hotBal,
              warmBal: bd.warmBal,
              coldBal: bd.coldBal,
              total: bd.total,
              hotCapVal: bd.hotCapVal,
              overCap: bd.overCap,
            };
          })
        );
        setBreakdowns(bds);
      } catch {
        setBreakdowns([]);
      }

      // Hot cap
      const capBps = await wr.hotCapBps();
      setHotCapBps(Number(capBps));

      // Multi-sig signers
      try {
        const s = await ms.getSigners();
        setSigners([...s]);
      } catch {
        setSigners([]);
      }

      // Multi-sig transactions
      try {
        const txCount = Number(await ms.transactionCount());
        const txs: MultiSigTx[] = [];
        for (let i = Math.max(0, txCount - 10); i < txCount; i++) {
          const tx = await ms.transactions(i);
          txs.push({
            id: i,
            token: tx.token,
            to: tx.to,
            amount: tx.amount,
            reason: tx.reason,
            proposedAt: Number(tx.proposedAt),
            executed: tx.executed,
            cancelled: tx.cancelled,
            confirmations: Number(tx.confirmations),
          });
        }
        setMultiSigTxs(txs);
      } catch {
        setMultiSigTxs([]);
      }

      // Sweep records
      try {
        const sweepCount = Number(await wr.sweepCount());
        const records: SweepRecord[] = [];
        for (let i = Math.max(0, sweepCount - 10); i < sweepCount; i++) {
          const r = await wr.sweepHistory(i);
          records.push({
            token: r.token,
            from: r.from,
            to: r.to,
            amount: r.amount,
            timestamp: Number(r.timestamp),
            reason: r.reason,
          });
        }
        setSweepRecords(records);
      } catch {
        setSweepRecords([]);
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load custody data');
    } finally {
      setLoading(false);
    }
  }, [contracts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Register wallet
  const handleRegisterWallet = async () => {
    if (!contracts || !newWalletAddr) return;
    setIsRegistering(true);
    try {
      const tx = await contracts.walletRegistry.registerWallet(newWalletAddr, newWalletTier, newWalletLabel);
      await tx.wait();
      setNewWalletAddr('');
      setNewWalletLabel('');
      loadData();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to register wallet');
    } finally {
      setIsRegistering(false);
    }
  };

  // Check and emit sweep
  const handleCheckSweep = async () => {
    if (!contracts) return;
    try {
      const tx = await contracts.walletRegistry.checkAndEmitSweep();
      await tx.wait();
      loadData();
    } catch (e: unknown) {
      setError((e as Error).message || 'Sweep check failed');
    }
  };

  const formatTokens = (val: bigint, decimals = 18) => {
    try {
      return Number(ethers.formatUnits(val, decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
    } catch {
      return '0';
    }
  };

  const pctOf = (part: bigint, total: bigint) => {
    if (total === 0n) return '0';
    return ((Number(part) / Number(total)) * 100).toFixed(2);
  };

  if (!account) {
    return (
      <div className="text-center text-gray-400 mt-20">
        <Vault size={64} className="mx-auto mb-4 text-gray-600" />
        <h2 className="text-xl font-semibold text-white mb-2">Wallet Custody</h2>
        <p>Connect your wallet to view custody architecture.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Vault size={32} className="text-purple-400" />
            Wallet Custody (98/2 Rule)
          </h1>
          <p className="text-gray-400 mt-1">
            Manage hot / warm / cold wallet tiers and enforce the SFC/VASP 98/2 custody rule.
          </p>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-gray-300 hover:bg-white/10 transition-colors"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-20">Loading custody data…</div>
      ) : (
        <>
          {/* ── Tier Breakdown Cards ── */}
          {breakdowns.length === 0 ? (
            <p className="text-gray-500 text-sm">No tracked tokens. Add tokens via WalletRegistry to see tier breakdowns.</p>
          ) : breakdowns.map((bd) => (
            <div key={bd.tokenAddress} className="mb-6">
              <h3 className="text-md font-semibold text-gray-200 mb-3 flex items-center gap-2">
                <Shield size={16} className="text-purple-400" />
                {bd.tokenSymbol} — {bd.tokenName}
                <span className="text-xs text-gray-500 font-mono">({bd.tokenAddress.slice(0, 6)}…{bd.tokenAddress.slice(-4)})</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Hot */}
            <div className="bg-white/5 border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Flame size={20} className="text-red-400" />
                <h3 className="text-sm font-semibold text-red-400 uppercase">Hot Wallet</h3>
              </div>
              <p className="text-2xl font-bold text-white">
                {formatTokens(bd.hotBal, bd.decimals)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {pctOf(bd.hotBal, bd.total)}% of AUM
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Cap: {(hotCapBps / 100).toFixed(1)}% ({formatTokens(bd.hotCapVal, bd.decimals)} tokens)
              </p>
            </div>

            {/* Warm */}
            <div className="bg-white/5 border border-yellow-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Thermometer size={20} className="text-yellow-400" />
                <h3 className="text-sm font-semibold text-yellow-400 uppercase">Warm Wallet</h3>
              </div>
              <p className="text-2xl font-bold text-white">
                {formatTokens(bd.warmBal, bd.decimals)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {pctOf(bd.warmBal, bd.total)}% of AUM
              </p>
              <p className="text-xs text-gray-500 mt-0.5">2-of-3 multi-sig required</p>
            </div>

            {/* Cold */}
            <div className="bg-white/5 border border-blue-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Snowflake size={20} className="text-blue-400" />
                <h3 className="text-sm font-semibold text-blue-400 uppercase">Cold Storage</h3>
              </div>
              <p className="text-2xl font-bold text-white">
                {formatTokens(bd.coldBal, bd.decimals)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {pctOf(bd.coldBal, bd.total)}% of AUM
              </p>
              <p className="text-xs text-gray-500 mt-0.5">FIPS 140-2 L3+ HSM / Air-gapped</p>
            </div>

            {/* Status */}
            <div className={`bg-white/5 border rounded-2xl p-5 ${
              bd.overCap
                ? 'border-red-500/30 bg-red-500/5'
                : 'border-green-500/20'
            }`}>
              <div className="flex items-center gap-2 mb-3">
                {bd.overCap ? (
                  <AlertTriangle size={20} className="text-red-400" />
                ) : (
                  <CheckCircle2 size={20} className="text-green-400" />
                )}
                <h3 className="text-sm font-semibold text-gray-300 uppercase">Compliance</h3>
              </div>
              <p className={`text-2xl font-bold ${bd.overCap ? 'text-red-400' : 'text-green-400'}`}>
                {bd.overCap ? 'OVER CAP' : 'COMPLIANT'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Total AUM: {formatTokens(bd.total, bd.decimals)} {bd.tokenSymbol}
              </p>
              {bd.overCap && (
                <button
                  onClick={handleCheckSweep}
                  className="mt-2 text-xs px-3 py-1 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                >
                  Trigger Sweep Check
                </button>
              )}
            </div>
              </div>
            </div>
          ))}

          {/* ── Registered Wallets Table ── */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Shield size={20} className="text-purple-400" />
                Registered Wallets ({wallets.length})
              </h2>
            </div>

            {wallets.length === 0 ? (
              <p className="text-gray-500 text-sm">No wallets registered yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-white/5">
                      <th className="text-left py-3 px-2">Address</th>
                      <th className="text-left py-3 px-2">Tier</th>
                      <th className="text-left py-3 px-2">Label</th>
                      <th className="text-left py-3 px-2">Status</th>
                      <th className="text-left py-3 px-2">Registered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallets.map((w) => (
                      <tr key={w.address} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-3 px-2 font-mono text-gray-300">{shortAddr(w.address)}</td>
                        <td className="py-3 px-2">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${TIER_COLORS[w.tier] || 'text-gray-400'}`}>
                            {TIER_ICONS[w.tier]}
                            {TIER_LABELS[w.tier]}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-gray-400">{w.label}</td>
                        <td className="py-3 px-2">
                          <span className={`text-xs font-medium ${w.active ? 'text-green-400' : 'text-gray-600'}`}>
                            {w.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-gray-500 text-xs">
                          {w.registeredAt > 0 ? new Date(w.registeredAt * 1000).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Register Wallet Form */}
            {roles.isAdmin && (
              <div className="mt-6 pt-4 border-t border-white/5">
                <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <Plus size={16} className="text-purple-400" />
                  Register New Wallet
                </h3>
                <div className="flex flex-wrap gap-3">
                  <input
                    type="text"
                    value={newWalletAddr}
                    onChange={(e) => setNewWalletAddr(e.target.value)}
                    placeholder="0x… wallet address"
                    className="flex-1 min-w-[300px] px-4 py-2 bg-black/20 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500 text-sm font-mono"
                  />
                  <select
                    value={newWalletTier}
                    onChange={(e) => setNewWalletTier(Number(e.target.value))}
                    className="px-4 py-2 bg-black/20 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-purple-500 text-sm"
                  >
                    <option value={1}>🔥 Hot</option>
                    <option value={2}>🌡️ Warm</option>
                    <option value={3}>❄️ Cold</option>
                  </select>
                  <input
                    type="text"
                    value={newWalletLabel}
                    onChange={(e) => setNewWalletLabel(e.target.value)}
                    placeholder="Label (e.g. Hot-FPS-1)"
                    className="flex-1 min-w-[200px] px-4 py-2 bg-black/20 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-purple-500 text-sm"
                  />
                  <button
                    onClick={handleRegisterWallet}
                    disabled={isRegistering || !newWalletAddr}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    {isRegistering ? 'Registering…' : 'Register'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Multi-Sig Warm Wallet ── */}
          <div className="bg-white/5 border border-yellow-500/20 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <Users size={20} className="text-yellow-400" />
              Multi-Sig Warm Wallet (2-of-3)
            </h2>

            {/* Signers */}
            <div className="mb-4">
              <h3 className="text-sm text-gray-400 mb-2">Authorized Signers</h3>
              <div className="flex flex-wrap gap-2">
                {signers.map((s, i) => (
                  <span key={i} className="px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs font-mono text-yellow-400">
                    #{i + 1} {shortAddr(s)}
                  </span>
                ))}
              </div>
            </div>

            {/* Transactions */}
            <h3 className="text-sm text-gray-400 mb-2">Recent Transactions</h3>
            {multiSigTxs.length === 0 ? (
              <p className="text-gray-600 text-sm">No multi-sig transactions yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-white/5">
                      <th className="text-left py-2 px-2"><Hash size={12} className="inline" /> ID</th>
                      <th className="text-left py-2 px-2">To</th>
                      <th className="text-left py-2 px-2">Amount</th>
                      <th className="text-left py-2 px-2">Reason</th>
                      <th className="text-left py-2 px-2">Confirms</th>
                      <th className="text-left py-2 px-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {multiSigTxs.map((tx) => (
                      <tr key={tx.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 px-2 text-gray-400">{tx.id}</td>
                        <td className="py-2 px-2 font-mono text-gray-300">{shortAddr(tx.to)}</td>
                        <td className="py-2 px-2 text-white">{formatTokens(tx.amount)}</td>
                        <td className="py-2 px-2 text-gray-400">{tx.reason}</td>
                        <td className="py-2 px-2 text-yellow-400">{tx.confirmations}/2</td>
                        <td className="py-2 px-2">
                          {tx.executed ? (
                            <span className="text-green-400 text-xs">✓ Executed</span>
                          ) : tx.cancelled ? (
                            <span className="text-red-400 text-xs">✗ Cancelled</span>
                          ) : (
                            <span className="text-yellow-400 text-xs">⏳ Pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Sweep Audit Trail ── */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
              <ArrowRightLeft size={20} className="text-purple-400" />
              Sweep / Rebalance Audit Trail
            </h2>
            {sweepRecords.length === 0 ? (
              <p className="text-gray-600 text-sm">No sweep records yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-white/5">
                      <th className="text-left py-2 px-2"><Clock size={12} className="inline" /> Time</th>
                      <th className="text-left py-2 px-2">From</th>
                      <th className="text-left py-2 px-2">To</th>
                      <th className="text-left py-2 px-2">Amount</th>
                      <th className="text-left py-2 px-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sweepRecords.map((r, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 px-2 text-gray-500 text-xs">
                          {new Date(r.timestamp * 1000).toLocaleString()}
                        </td>
                        <td className="py-2 px-2 font-mono text-gray-300">{shortAddr(r.from)}</td>
                        <td className="py-2 px-2 font-mono text-gray-300">{shortAddr(r.to)}</td>
                        <td className="py-2 px-2 text-white">{formatTokens(r.amount)}</td>
                        <td className="py-2 px-2 text-gray-400">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default WalletCustody;
