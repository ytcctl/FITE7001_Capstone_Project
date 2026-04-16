import React, { useState, useEffect, useCallback } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { CONTRACT_ADDRESSES, SECURITY_TOKEN_ABI, CASH_TOKEN_ABI } from '../config/contracts';
import { ArrowRightLeft, Plus, Play, XCircle, RefreshCw, Loader2, CheckSquare } from 'lucide-react';
import { ethers } from 'ethers';

interface TokenOption {
  name: string;
  symbol: string;
  address: string;
}

interface SettlementData {
  id: number;
  seller: string;
  buyer: string;
  securityToken: string;
  securitySymbol: string;
  cashToken: string;
  cashSymbol: string;
  tokenAmount: string;
  cashAmount: string;
  status: number;
  matchId: string;
  deadline: number;
  createdBy: string;
}

const STATUS_LABELS = ['Pending', 'Settled', 'Failed', 'Cancelled'];
const STATUS_COLORS = [
  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'bg-red-500/20 text-red-400 border-red-500/30',
  'bg-gray-500/20 text-gray-400 border-gray-500/30',
];
const EXPIRED_COLOR = 'bg-orange-500/20 text-orange-400 border-orange-500/30';

/** Returns true if a pending settlement's deadline has passed */
const isExpired = (s: SettlementData) => s.status === 0 && s.deadline > 0 && Date.now() / 1000 > s.deadline;

const Settlement: React.FC = () => {
  const { account, contracts } = useWeb3();

  // Token selector
  const [tokenOptions, setTokenOptions] = useState<TokenOption[]>([]);
  const [selectedSecurityToken, setSelectedSecurityToken] = useState('');

  // Create
  const [seller, setSeller] = useState('');
  const [buyer, setBuyer] = useState('');
  const [tokenAmount, setTokenAmount] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [deadlineHours, setDeadlineHours] = useState('24');
  // Execute / Cancel
  const [executeId, setExecuteId] = useState('');
  // List
  const [settlements, setSettlements] = useState<SettlementData[]>([]);
  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Batch execute
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Load available security tokens from factory contracts
  const loadTokenOptions = useCallback(async () => {
    if (!contracts) return;
    const options: TokenOption[] = [];
    // Default security token
    try {
      const [name, symbol] = await Promise.all([
        contracts.securityToken.name(),
        contracts.securityToken.symbol(),
      ]);
      const addr = await contracts.securityToken.getAddress();
      options.push({ name, symbol, address: addr });
    } catch {}
    // V1 factory tokens
    try {
      const all = await contracts.tokenFactory.allTokens();
      for (const t of all) {
        if (!t.active) continue;
        if (options.find(o => o.address.toLowerCase() === t.tokenAddress.toLowerCase())) continue;
        options.push({ name: t.name, symbol: t.symbol, address: t.tokenAddress });
      }
    } catch {}
    // V2 factory tokens
    try {
      const allV2 = await contracts.tokenFactoryV2.allTokens();
      for (const t of allV2) {
        if (!t.active) continue;
        if (options.find(o => o.address.toLowerCase() === t.proxyAddress.toLowerCase())) continue;
        options.push({ name: t.name, symbol: t.symbol, address: t.proxyAddress });
      }
    } catch {}
    setTokenOptions(options);
    if (options.length > 0 && !selectedSecurityToken) {
      setSelectedSecurityToken(options[0].address);
    }
  }, [contracts, selectedSecurityToken]);

  // Cache resolved ERC-20 symbols so we don't re-query the same token contract
  const symbolCache = React.useRef<Record<string, string>>({});

  const resolveSymbol = async (tokenAddr: string, provider: ethers.Provider): Promise<string> => {
    const key = tokenAddr.toLowerCase();
    if (symbolCache.current[key]) return symbolCache.current[key];
    try {
      const c = new ethers.Contract(tokenAddr, ['function symbol() view returns (string)'], provider);
      const sym = await c.symbol();
      symbolCache.current[key] = sym;
      return sym;
    } catch {
      const short = `${tokenAddr.slice(0, 6)}…${tokenAddr.slice(-4)}`;
      symbolCache.current[key] = short;
      return short;
    }
  };

  const loadSettlements = async () => {
    if (!contracts) return;
    try {
      const count = await contracts.dvpSettlement.settlementCount();
      const provider = (contracts.dvpSettlement.runner as ethers.Signer).provider!;
      const items: SettlementData[] = [];
      for (let i = 0; i < Number(count); i++) {
        const s = await contracts.dvpSettlement.settlements(i);
        const [securitySymbol, cashSymbol] = await Promise.all([
          resolveSymbol(s.securityToken, provider),
          resolveSymbol(s.cashToken, provider),
        ]);
        items.push({
          id: i,
          seller: s.seller,
          buyer: s.buyer,
          securityToken: s.securityToken,
          securitySymbol,
          cashToken: s.cashToken,
          cashSymbol,
          tokenAmount: ethers.formatUnits(s.tokenAmount, 18),
          cashAmount: ethers.formatUnits(s.cashAmount, 6),
          status: Number(s.status),
          matchId: s.matchId,
          deadline: Number(s.settlementDeadline),
          createdBy: s.createdBy,
        });
      }
      setSettlements(items);
    } catch (e) {
      console.error('Load settlements error:', e);
    }
  };

  useEffect(() => {
    loadSettlements();
    loadTokenOptions();
  }, [contracts]);

  const handleCreate = async () => {
    if (!contracts || !seller || !buyer || !tokenAmount || !cashAmount || !selectedSecurityToken) return;
    setIsSubmitting(true);
    setTxStatus('Creating settlement…');
    try {
      const signer = (contracts.dvpSettlement as any).runner as ethers.Signer;
      const me = (await signer.getAddress()).toLowerCase();
      const dvpAddr = await contracts.dvpSettlement.getAddress();
      const tokenAmountBN = ethers.parseUnits(tokenAmount, 18);
      const cashAmountBN = ethers.parseUnits(cashAmount, 6);

      // Pre-approve tokens so executeSettlement can transferFrom later.
      // The seller must approve security tokens; the buyer must approve cash tokens.
      // Only the connected wallet can approve its own tokens.
      if (me === seller.toLowerCase()) {
        setTxStatus('Approving security token for DvP…');
        const secToken = new ethers.Contract(selectedSecurityToken, SECURITY_TOKEN_ABI, signer);
        const allowance: bigint = await secToken.allowance(me, dvpAddr);
        if (allowance < tokenAmountBN) {
          const appTx = await secToken.approve(dvpAddr, tokenAmountBN);
          await appTx.wait();
        }
      }
      if (me === buyer.toLowerCase()) {
        setTxStatus('Approving cash token for DvP…');
        const cashToken = new ethers.Contract(CONTRACT_ADDRESSES.cashToken, CASH_TOKEN_ABI, signer);
        const allowance: bigint = await cashToken.allowance(me, dvpAddr);
        if (allowance < cashAmountBN) {
          const appTx = await cashToken.approve(dvpAddr, cashAmountBN);
          await appTx.wait();
        }
      }

      setTxStatus('Creating settlement…');
      const deadline = Math.floor(Date.now() / 1000) + Number(deadlineHours) * 3600;
      const matchId = ethers.keccak256(ethers.toUtf8Bytes(`match-${Date.now()}`));
      const tx = await contracts.dvpSettlement.createSettlement(
        seller,
        buyer,
        selectedSecurityToken,
        tokenAmountBN,
        CONTRACT_ADDRESSES.cashToken,
        cashAmountBN,
        deadline,
        matchId
      );
      await tx.wait();
      setTxStatus('✓ Settlement created successfully');
      setTokenAmount('');
      setCashAmount('');
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Create failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExecute = async (id: number) => {
    if (!contracts) return;
    setIsSubmitting(true);
    setTxStatus(`Executing settlement #${id}…`);
    try {
      // Fetch settlement details to check required approvals
      const s = await contracts.dvpSettlement.settlements(id);
      const dvpAddr = await contracts.dvpSettlement.getAddress();
      const signer = (contracts.dvpSettlement as any).runner as ethers.Signer;
      const me = await signer.getAddress();
      const meLower = me.toLowerCase();

      // Check & approve security token (seller → DvP)
      if (meLower === s.seller.toLowerCase()) {
        const secToken = new ethers.Contract(s.securityToken, SECURITY_TOKEN_ABI, signer);
        const allowanceSec: bigint = await secToken.allowance(me, dvpAddr);
        if (allowanceSec < s.tokenAmount) {
          setTxStatus(`Approving security token for settlement #${id}…`);
          const appTx = await secToken.approve(dvpAddr, s.tokenAmount);
          await appTx.wait();
        }
      }

      // Check & approve cash token (buyer → DvP)
      if (meLower === s.buyer.toLowerCase()) {
        const cashToken = new ethers.Contract(s.cashToken, CASH_TOKEN_ABI, signer);
        const allowanceCash: bigint = await cashToken.allowance(me, dvpAddr);
        if (allowanceCash < s.cashAmount) {
          setTxStatus(`Approving cash token for settlement #${id}…`);
          const appTx = await cashToken.approve(dvpAddr, s.cashAmount);
          await appTx.wait();
        }
      }

      setTxStatus(`Executing settlement #${id}…`);
      const tx = await contracts.dvpSettlement.executeSettlement(id);
      const receipt = await tx.wait();

      // Pre-flight failures mark the settlement as Failed without reverting.
      // Check the tx receipt for a SettlementFailed event.
      const failedEvent = receipt.logs
        .map((log: any) => { try { return contracts.dvpSettlement.interface.parseLog(log); } catch { return null; } })
        .find((parsed: any) => parsed?.name === 'SettlementFailed');

      if (failedEvent) {
        const reason = failedEvent.args?.reason || 'Pre-flight check failed';
        setTxStatus(`✗ Settlement #${id} failed: ${reason}`);
      } else {
        setTxStatus(`✓ Settlement #${id} executed — DvP atomic swap complete`);
      }
      loadSettlements();
    } catch (e: any) {
      const msg = e?.reason || e?.message || '';
      if (msg.includes('creator cannot execute') || msg.includes('createdBy')) {
        setTxStatus('✗ Only Counterparty can execute the DvP settlement.');
      } else {
        setTxStatus(`✗ ${msg || 'Execute failed'}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (id: number) => {
    if (!contracts) return;
    setIsSubmitting(true);
    setTxStatus(`Cancelling settlement #${id}…`);
    try {
      const tx = await contracts.dvpSettlement.cancelSettlement(id);
      await tx.wait();
      setTxStatus(`✓ Settlement #${id} cancelled`);
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Cancel failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleMarkFailed = async (id: number) => {
    if (!contracts) return;
    setIsSubmitting(true);
    setTxStatus(`Marking settlement #${id} as failed (deadline passed)…`);
    try {
      const tx = await contracts.dvpSettlement.markFailed(id);
      await tx.wait();
      setTxStatus(`✓ Settlement #${id} marked as Failed (deadline expired)`);
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Mark failed error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const pendingIds = settlements.filter((s) => s.status === 0 && !isExpired(s)).map((s) => s.id);

  const toggleSelectAll = () => {
    if (pendingIds.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingIds));
    }
  };

  const handleBatchExecute = async () => {
    if (!contracts || selectedIds.size === 0) return;
    setIsSubmitting(true);
    const ids = Array.from(selectedIds);
    setTxStatus(`Batch executing ${ids.length} settlement(s)… approving tokens…`);
    try {
      const dvpAddr = await contracts.dvpSettlement.getAddress();
      const signer = (contracts.dvpSettlement as any).runner as ethers.Signer;
      const me = (await signer.getAddress()).toLowerCase();

      // Approve all tokens the connected user owes across selected settlements
      for (const id of ids) {
        const s = await contracts.dvpSettlement.settlements(id);
        // Creator cannot execute their own settlement — must be counterparty
        if (me === s.createdBy.toLowerCase()) {
          setTxStatus('✗ Only Counterparty can execute the DvP settlement.');
          setIsSubmitting(false);
          return;
        }
        if (me === s.seller.toLowerCase()) {
          const secToken = new ethers.Contract(s.securityToken, SECURITY_TOKEN_ABI, signer);
          const allowance: bigint = await secToken.allowance(await signer.getAddress(), dvpAddr);
          if (allowance < s.tokenAmount) {
            const appTx = await secToken.approve(dvpAddr, s.tokenAmount);
            await appTx.wait();
          }
        }
        if (me === s.buyer.toLowerCase()) {
          const cashToken = new ethers.Contract(s.cashToken, CASH_TOKEN_ABI, signer);
          const allowance: bigint = await cashToken.allowance(await signer.getAddress(), dvpAddr);
          if (allowance < s.cashAmount) {
            const appTx = await cashToken.approve(dvpAddr, s.cashAmount);
            await appTx.wait();
          }
        }
      }

      setTxStatus(`Batch executing ${ids.length} settlement(s)…`);
      const tx = await contracts.dvpSettlement.executeBatchSettlement(ids, false);
      const receipt = await tx.wait();
      setTxStatus(`✓ Batch execute complete — ${ids.length} settlement(s) processed`);
      setSelectedIds(new Set());
      loadSettlements();
    } catch (e: any) {
      const msg = e?.reason || e?.message || '';
      if (msg.includes('creator cannot execute') || msg.includes('createdBy')) {
        setTxStatus('✗ Only Counterparty can execute the DvP settlement.');
      } else {
        setTxStatus(`✗ ${msg || 'Batch execute failed'}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <ArrowRightLeft size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">DvP Settlement</h2>
        <p className="text-gray-400">Connect your wallet to create and execute atomic DvP settlements.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">DvP Settlement</h2>
          <p className="text-gray-400">Atomic delivery-versus-payment settlement of security tokens for cash.</p>
        </div>
        <button onClick={loadSettlements} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
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

      {/* Create Settlement */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Plus size={20} className="text-purple-400" />
          <h3 className="font-bold text-white">Create Settlement</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Seller Address</label>
            <input
              type="text"
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
              placeholder="0x…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Buyer Address</label>
            <input
              type="text"
              value={buyer}
              onChange={(e) => setBuyer(e.target.value)}
              placeholder="0x…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Security Token</label>
            <select
              value={selectedSecurityToken}
              onChange={(e) => setSelectedSecurityToken(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            >
              {tokenOptions.length === 0 && <option value="">Loading tokens…</option>}
              {tokenOptions.map((t) => (
                <option key={t.address} value={t.address} className="bg-gray-900">
                  {t.symbol} — {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Security Token Amount</label>
            <input
              type="text"
              value={tokenAmount}
              onChange={(e) => setTokenAmount(e.target.value)}
              placeholder="100"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Cash Amount (THKD)</label>
            <input
              type="text"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              placeholder="50000"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Deadline (hours from now)</label>
            <input
              type="text"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleCreate}
              disabled={isSubmitting || !seller || !buyer || !tokenAmount || !cashAmount || !selectedSecurityToken}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              Create Settlement
            </button>
          </div>
        </div>
      </div>

      {/* Batch Execute Bar */}
      {pendingIds.length > 0 && (
        <div className="glass-card px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckSquare size={18} className="text-purple-400" />
            <span className="text-sm text-gray-300">
              {selectedIds.size} of {pendingIds.length} pending settlement(s) selected
            </span>
          </div>
          <button
            onClick={handleBatchExecute}
            disabled={isSubmitting || selectedIds.size === 0}
            className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white py-2 px-5 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
            <Play size={14} />
            Batch Execute ({selectedIds.size})
          </button>
        </div>
      )}

      {/* Settlements List */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <h3 className="font-bold text-white">Settlement History</h3>
        </div>
        {settlements.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No settlements found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-white/5 text-xs text-gray-400 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium w-10">
                    {pendingIds.length > 0 && (
                      <input
                        type="checkbox"
                        checked={pendingIds.length > 0 && pendingIds.every((id) => selectedIds.has(id))}
                        onChange={toggleSelectAll}
                        className="accent-purple-500 w-4 h-4 cursor-pointer"
                        title="Select all pending"
                      />
                    )}
                  </th>
                  <th className="px-6 py-3 font-medium">ID</th>
                  <th className="px-6 py-3 font-medium">Seller</th>
                  <th className="px-6 py-3 font-medium">Buyer</th>
                  <th className="px-6 py-3 font-medium">Security Token</th>
                  <th className="px-6 py-3 font-medium">Amount</th>
                  <th className="px-6 py-3 font-medium">Cash Token</th>
                  <th className="px-6 py-3 font-medium">Cash Amt</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Created By</th>
                  <th className="px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {settlements.map((s) => (
                  <tr key={s.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-4">
                      {s.status === 0 && !isExpired(s) && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.id)}
                          onChange={() => toggleSelect(s.id)}
                          className="accent-purple-500 w-4 h-4 cursor-pointer"
                        />
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">#{s.id}</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">{s.seller.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">{s.buyer.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm">
                      <span className="text-purple-300 font-medium">{s.securitySymbol}</span>
                      <span className="block text-[10px] font-mono text-gray-500" title={s.securityToken}>{s.securityToken.slice(0, 6)}…{s.securityToken.slice(-4)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-white">{Number(s.tokenAmount).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className="text-emerald-300 font-medium">{s.cashSymbol}</span>
                      <span className="block text-[10px] font-mono text-gray-500" title={s.cashToken}>{s.cashToken.slice(0, 6)}…{s.cashToken.slice(-4)}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-white">{Number(s.cashAmount).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${isExpired(s) ? EXPIRED_COLOR : STATUS_COLORS[s.status]}`}>
                        {isExpired(s) ? 'Expired' : STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300" title={s.createdBy}>
                      {s.createdBy.slice(0, 8)}…
                      {account && s.createdBy.toLowerCase() === account.toLowerCase() && (
                        <span className="block text-[10px] text-amber-400">(you)</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {s.status === 0 && (
                        <div className="flex gap-2">
                          {isExpired(s) ? (
                            <button
                              onClick={() => handleMarkFailed(s.id)}
                              className="text-xs bg-orange-500/20 text-orange-400 px-3 py-1 rounded-lg hover:bg-orange-500/30 transition-colors border border-orange-500/20"
                            >
                              <XCircle size={12} className="inline mr-1" />
                              Mark Failed
                            </button>
                          ) : account && s.createdBy.toLowerCase() === account.toLowerCase() ? (
                            <span className="text-xs text-gray-500 italic">Awaiting counterparty</span>
                          ) : (
                            <>
                              <button
                                onClick={() => handleExecute(s.id)}
                                className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-lg hover:bg-emerald-500/30 transition-colors border border-emerald-500/20"
                              >
                                <Play size={12} className="inline mr-1" />
                                Execute
                              </button>
                              <button
                                onClick={() => handleCancel(s.id)}
                                className="text-xs bg-red-500/20 text-red-400 px-3 py-1 rounded-lg hover:bg-red-500/30 transition-colors border border-red-500/20"
                              >
                                <XCircle size={12} className="inline mr-1" />
                                Cancel
                              </button>
                            </>
                          )}
                        </div>
                      )}
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

export default Settlement;
