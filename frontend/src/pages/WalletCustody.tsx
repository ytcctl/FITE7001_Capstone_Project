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
  Send,
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
  confirmedByMe: boolean;
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
  const [tokenOptions, setTokenOptions] = useState<{ address: string; name: string; symbol: string; decimals: number }[]>([]);
  const [selectedToken, setSelectedToken] = useState<string>('');
  const [breakdown, setBreakdown] = useState<TierBreakdown | null>(null);
  const [hotCapBps, setHotCapBps] = useState<number>(0);
  const [multiSigTxs, setMultiSigTxs] = useState<MultiSigTx[]>([]);
  const [signers, setSigners] = useState<string[]>([]);
  const [sweepRecords, setSweepRecords] = useState<SweepRecord[]>([]);
  const [isSigner, setIsSigner] = useState(false);
  const [warmBalances, setWarmBalances] = useState<{ address: string; symbol: string; name: string; decimals: number; balance: bigint }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [newWalletAddr, setNewWalletAddr] = useState('');
  const [newWalletTier, setNewWalletTier] = useState(1);
  const [newWalletLabel, setNewWalletLabel] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Propose form state
  const [proposeToken, setProposeToken] = useState('');
  const [proposeTo, setProposeTo] = useState('');
  const [proposeAmount, setProposeAmount] = useState('');
  const [proposeReason, setProposeReason] = useState('sweep-to-cold');
  const [isProposing, setIsProposing] = useState(false);
  const [proposeStatus, setProposeStatus] = useState<string | null>(null);

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

      // Fetch tracked token list (lightweight — name/symbol only, no breakdown yet)
      try {
        const trackedTokens: string[] = await wr.getTrackedTokens();
        const erc20MinAbi = [
          'function name() view returns (string)',
          'function symbol() view returns (string)',
          'function decimals() view returns (uint8)',
        ];
        const provider = wr.runner?.provider ?? wr.runner;
        const opts = await Promise.all(
          trackedTokens.map(async (tokenAddr: string) => {
            let name = tokenAddr.slice(0, 10) + '…';
            let symbol = '???';
            let decimals = 18;
            try {
              const tok = new ethers.Contract(tokenAddr, erc20MinAbi, provider);
              [name, symbol, decimals] = await Promise.all([
                tok.name(),
                tok.symbol(),
                tok.decimals().then(Number),
              ]);
            } catch { /* fallback */ }
            return { address: tokenAddr, name, symbol, decimals };
          })
        );
        setTokenOptions(opts);
        // Auto-select first token if none selected
        if (opts.length > 0 && !selectedToken) {
          setSelectedToken(opts[0].address);
        }
      } catch {
        setTokenOptions([]);
      }

      // Hot cap
      const capBps = await wr.hotCapBps();
      setHotCapBps(Number(capBps));

      // Warm wallet token balances
      try {
        const msAddress = await ms.getAddress();
        const erc20Abi = [
          'function balanceOf(address) view returns (uint256)',
          'function symbol() view returns (string)',
          'function name() view returns (string)',
          'function decimals() view returns (uint8)',
        ];
        const provider = wr.runner?.provider ?? wr.runner;
        const trackedTokens: string[] = await wr.getTrackedTokens();
        const bals = await Promise.all(
          trackedTokens.map(async (tokenAddr: string) => {
            const tok = new ethers.Contract(tokenAddr, erc20Abi, provider);
            const [balance, symbol, name, decimals] = await Promise.all([
              tok.balanceOf(msAddress),
              tok.symbol().catch(() => '???'),
              tok.name().catch(() => tokenAddr.slice(0, 10)),
              tok.decimals().then(Number).catch(() => 18),
            ]);
            return { address: tokenAddr, symbol, name, decimals, balance };
          })
        );
        setWarmBalances(bals);
      } catch {
        setWarmBalances([]);
      }

      // Multi-sig signers
      try {
        const s = await ms.getSigners();
        setSigners([...s]);
        // Check if current account is a signer
        if (account) {
          try {
            const signer = await ms.isSigner(account);
            setIsSigner(signer);
          } catch { setIsSigner(false); }
        }
      } catch {
        setSigners([]);
        setIsSigner(false);
      }

      // Multi-sig transactions
      try {
        const txCount = Number(await ms.transactionCount());
        const txs: MultiSigTx[] = [];
        for (let i = Math.max(0, txCount - 10); i < txCount; i++) {
          const tx = await ms.transactions(i);
          let myConfirm = false;
          if (account && !tx.executed && !tx.cancelled) {
            try { myConfirm = await ms.confirmed(i, account); } catch { /* ignore */ }
          }
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
            confirmedByMe: myConfirm,
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

  // Load tier breakdown for the selected token
  const loadBreakdown = useCallback(async () => {
    if (!contracts || !selectedToken) { setBreakdown(null); return; }
    const opt = tokenOptions.find(t => t.address === selectedToken);
    if (!opt) { setBreakdown(null); return; }
    try {
      const bd = await contracts.walletRegistry.tierBreakdown(selectedToken);
      setBreakdown({
        tokenAddress: selectedToken,
        tokenName: opt.name,
        tokenSymbol: opt.symbol,
        decimals: opt.decimals,
        hotBal: bd.hotBal,
        warmBal: bd.warmBal,
        coldBal: bd.coldBal,
        total: bd.total,
        hotCapVal: bd.hotCapVal,
        overCap: bd.overCap,
      });
    } catch {
      setBreakdown(null);
    }
  }, [contracts, selectedToken, tokenOptions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    loadBreakdown();
  }, [loadBreakdown]);

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

  // Deactivate or reactivate a wallet
  const handleToggleWallet = async (address: string, currentlyActive: boolean) => {
    if (!contracts) return;
    try {
      const tx = currentlyActive
        ? await contracts.walletRegistry.deactivateWallet(address)
        : await contracts.walletRegistry.reactivateWallet(address);
      await tx.wait();
      loadData();
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to update wallet status');
    }
  };

  // Propose a multi-sig transfer
  const handlePropose = async () => {
    if (!contracts || !proposeToken || !proposeTo || !proposeAmount) return;
    setIsProposing(true);
    setProposeStatus(null);
    try {
      const opt = tokenOptions.find(t => t.address === proposeToken);
      const decimals = opt?.decimals ?? 18;
      const amountWei = ethers.parseUnits(proposeAmount, decimals);
      const tx = await contracts.multiSigWarm.proposeTx(proposeToken, proposeTo, amountWei, proposeReason);
      await tx.wait();
      setProposeStatus('Transaction proposed successfully');
      setProposeTo('');
      setProposeAmount('');
      setProposeReason('sweep-to-cold');
      loadData();
    } catch (e: unknown) {
      setProposeStatus((e as Error).message || 'Failed to propose transaction');
    } finally {
      setIsProposing(false);
    }
  };

  // Parse multi-sig contract errors into human-readable messages
  const parseMultiSigError = (e: unknown, fallback: string): string => {
    const err = e as { reason?: string; message?: string; data?: string };
    const reason = err?.reason || '';
    const knownErrors: Record<string, string> = {
      'MultiSigWarm: already confirmed': 'You have already confirmed this transaction. A different signer must confirm.',
      'MultiSigWarm: not signer': 'Only authorized signers can perform this action.',
      'MultiSigWarm: tx does not exist': 'This transaction does not exist.',
      'MultiSigWarm: already executed': 'This transaction has already been executed.',
      'MultiSigWarm: already cancelled': 'This transaction has already been cancelled.',
      'MultiSigWarm: expired': 'This transaction has expired (48-hour limit exceeded).',
      'MultiSigWarm: not enough confirmations': 'Not enough confirmations yet — at least 2 of 3 signers must confirm before execution.',
      'MultiSigWarm: not confirmed': 'You have not confirmed this transaction, so you cannot revoke.',
      'MultiSigWarm: transfer failed': 'The token transfer failed. Ensure the warm wallet holds sufficient balance.',
    };
    // ERC-20 custom error: ERC20InsufficientBalance(address,uint256,uint256)
    if (err?.data?.startsWith?.('0xe450d38c') || err?.message?.includes?.('0xe450d38c')) {
      return 'Insufficient warm wallet balance. Transfer tokens into the MultiSigWarm contract before executing.';
    }
    if (reason && knownErrors[reason]) return knownErrors[reason];
    // Try matching partial reason from message
    for (const [key, msg] of Object.entries(knownErrors)) {
      if (err?.message?.includes(key)) return msg;
    }
    return err?.reason || err?.message || fallback;
  };

  // Confirm a pending multi-sig transaction
  const handleConfirm = async (txId: number) => {
    if (!contracts) return;
    try {
      const tx = await contracts.multiSigWarm.confirmTx(txId);
      await tx.wait();
      loadData();
    } catch (e: unknown) {
      setError(parseMultiSigError(e, 'Failed to confirm transaction'));
    }
  };

  // Execute a fully-confirmed multi-sig transaction
  const handleExecute = async (txId: number) => {
    if (!contracts) return;
    try {
      const tx = await contracts.multiSigWarm.executeTx(txId);
      await tx.wait();
      loadData();
    } catch (e: unknown) {
      setError(parseMultiSigError(e, 'Failed to execute transaction'));
    }
  };

  // Cancel a pending multi-sig transaction
  const handleCancel = async (txId: number) => {
    if (!contracts) return;
    try {
      const tx = await contracts.multiSigWarm.cancelTx(txId);
      await tx.wait();
      loadData();
    } catch (e: unknown) {
      setError(parseMultiSigError(e, 'Failed to cancel transaction'));
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
          {/* ── Token Selector + Tier Breakdown ── */}
          {tokenOptions.length === 0 ? (
            <p className="text-gray-500 text-sm">No tracked tokens. Add tokens via WalletRegistry to see tier breakdowns.</p>
          ) : (
            <>
              {/* Dropdown */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400 whitespace-nowrap">Select Token:</label>
                <select
                  value={selectedToken}
                  onChange={(e) => setSelectedToken(e.target.value)}
                  className="flex-1 max-w-md px-4 py-2 bg-black/20 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-1 focus:ring-purple-500 text-sm"
                >
                  {tokenOptions.map((t) => (
                    <option key={t.address} value={t.address}>
                      {t.symbol} — {t.name} ({t.address.slice(0, 6)}…{t.address.slice(-4)})
                    </option>
                  ))}
                </select>
                <span className="text-xs text-gray-500">{tokenOptions.length} token{tokenOptions.length !== 1 ? 's' : ''} tracked</span>
              </div>

              {/* Tier Breakdown Cards for selected token */}
              {breakdown ? (
              <div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Hot */}
            <div className="bg-white/5 border border-red-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Flame size={20} className="text-red-400" />
                <h3 className="text-sm font-semibold text-red-400 uppercase">Hot Wallet</h3>
              </div>
              <p className="text-2xl font-bold text-white">
                {formatTokens(breakdown.hotBal, breakdown.decimals)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {pctOf(breakdown.hotBal, breakdown.total)}% of AUM
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Cap: {(hotCapBps / 100).toFixed(1)}% ({formatTokens(breakdown.hotCapVal, breakdown.decimals)} tokens)
              </p>
            </div>

            {/* Warm */}
            <div className="bg-white/5 border border-yellow-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <Thermometer size={20} className="text-yellow-400" />
                <h3 className="text-sm font-semibold text-yellow-400 uppercase">Warm Wallet</h3>
              </div>
              <p className="text-2xl font-bold text-white">
                {formatTokens(breakdown.warmBal, breakdown.decimals)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {pctOf(breakdown.warmBal, breakdown.total)}% of AUM
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
                {formatTokens(breakdown.coldBal, breakdown.decimals)}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {pctOf(breakdown.coldBal, breakdown.total)}% of AUM
              </p>
              <p className="text-xs text-gray-500 mt-0.5">FIPS 140-2 L3+ HSM / Air-gapped</p>
            </div>

            {/* Status */}
            <div className={`bg-white/5 border rounded-2xl p-5 ${
              breakdown.overCap
                ? 'border-red-500/30 bg-red-500/5'
                : 'border-green-500/20'
            }`}>
              <div className="flex items-center gap-2 mb-3">
                {breakdown.overCap ? (
                  <AlertTriangle size={20} className="text-red-400" />
                ) : (
                  <CheckCircle2 size={20} className="text-green-400" />
                )}
                <h3 className="text-sm font-semibold text-gray-300 uppercase">Compliance</h3>
              </div>
              <p className={`text-2xl font-bold ${breakdown.overCap ? 'text-red-400' : 'text-green-400'}`}>
                {breakdown.overCap ? 'OVER CAP' : 'COMPLIANT'}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Total AUM: {formatTokens(breakdown.total, breakdown.decimals)} {breakdown.tokenSymbol}
              </p>
              {breakdown.overCap && (
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
              ) : (
                <p className="text-gray-500 text-sm">Select a token to view tier breakdown.</p>
              )}
            </>
          )}

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
                      {roles.isAdmin && <th className="text-left py-3 px-2">Actions</th>}
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
                        {roles.isAdmin && (
                          <td className="py-3 px-2">
                            <button
                              onClick={() => handleToggleWallet(w.address, w.active)}
                              className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                                w.active
                                  ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20'
                                  : 'bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20'
                              }`}
                            >
                              {w.active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          </td>
                        )}
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

            {/* Warm Wallet Balances */}
            <div className="mb-4">
              <h3 className="text-sm text-gray-400 mb-2">Warm Wallet Holdings</h3>
              {warmBalances.length === 0 ? (
                <p className="text-gray-600 text-sm">No tracked tokens.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {warmBalances.map((b) => (
                    <div key={b.address} className={`px-3 py-2 rounded-lg border text-xs ${
                      b.balance === 0n
                        ? 'bg-red-500/5 border-red-500/20 text-red-400'
                        : 'bg-yellow-500/5 border-yellow-500/20 text-yellow-300'
                    }`}>
                      <span className="font-medium">{b.symbol}</span>
                      <span className="ml-2 font-mono">{formatTokens(b.balance, b.decimals)}</span>
                      {b.balance === 0n && <span className="ml-1 text-red-500">⚠ empty</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Propose Transfer Form — only for signers */}
            {isSigner && (
              <div className="mb-6 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
                <h3 className="text-sm font-medium text-yellow-400 mb-3 flex items-center gap-2">
                  <Send size={14} /> Propose Transfer
                </h3>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[180px]">
                    <label className="text-xs text-gray-500 mb-1 block">Token</label>
                    <select
                      value={proposeToken}
                      onChange={(e) => setProposeToken(e.target.value)}
                      className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                    >
                      <option value="">Select token…</option>
                      {tokenOptions.map((t) => (
                        <option key={t.address} value={t.address}>
                          {t.symbol} — {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <label className="text-xs text-gray-500 mb-1 block">Destination Address</label>
                    <input
                      type="text"
                      value={proposeTo}
                      onChange={(e) => setProposeTo(e.target.value)}
                      placeholder="0x…"
                      className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-gray-600 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-yellow-500"
                    />
                  </div>
                  <div className="min-w-[120px]">
                    <label className="text-xs text-gray-500 mb-1 block">Amount</label>
                    <input
                      type="text"
                      value={proposeAmount}
                      onChange={(e) => setProposeAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder:text-gray-600 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                    />
                  </div>
                  <div className="min-w-[160px]">
                    <label className="text-xs text-gray-500 mb-1 block">Reason</label>
                    <select
                      value={proposeReason}
                      onChange={(e) => setProposeReason(e.target.value)}
                      className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
                    >
                      <option value="sweep-to-cold">Sweep to Cold</option>
                      <option value="replenish-hot">Replenish Hot</option>
                      <option value="withdrawal">Withdrawal</option>
                      <option value="rebalance">Rebalance</option>
                    </select>
                  </div>
                  <button
                    onClick={handlePropose}
                    disabled={isProposing || !proposeToken || !proposeTo || !proposeAmount}
                    className="px-5 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {isProposing ? 'Proposing…' : 'Propose'}
                  </button>
                </div>
                {proposeStatus && (
                  <p className={`mt-2 text-xs ${proposeStatus.includes('success') ? 'text-green-400' : 'text-red-400'}`}>
                    {proposeStatus}
                  </p>
                )}
              </div>
            )}

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
                      {isSigner && <th className="text-left py-2 px-2">Actions</th>}
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
                        {isSigner && (
                          <td className="py-2 px-2">
                            {!tx.executed && !tx.cancelled && (
                              <div className="flex gap-1.5">
                                {tx.confirmedByMe ? (
                                  <span className="px-2 py-1 bg-blue-600/30 text-blue-300/60 rounded text-xs cursor-not-allowed" title="You already confirmed this transaction">
                                    ✓ Confirmed
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => handleConfirm(tx.id)}
                                    className="px-2 py-1 bg-blue-600/80 hover:bg-blue-600 text-white rounded text-xs transition-colors"
                                    title="Confirm this transaction"
                                  >
                                    Confirm
                                  </button>
                                )}
                                {tx.confirmations >= 2 && (
                                  <button
                                    onClick={() => handleExecute(tx.id)}
                                    className="px-2 py-1 bg-green-600/80 hover:bg-green-600 text-white rounded text-xs transition-colors"
                                    title="Execute (requires 2+ confirmations)"
                                  >
                                    Execute
                                  </button>
                                )}
                                <button
                                  onClick={() => handleCancel(tx.id)}
                                  className="px-2 py-1 bg-red-600/80 hover:bg-red-600 text-white rounded text-xs transition-colors"
                                  title="Cancel this transaction"
                                >
                                  Cancel
                                </button>
                              </div>
                            )}
                          </td>
                        )}
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
