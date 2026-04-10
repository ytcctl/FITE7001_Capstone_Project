import React, { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { CONTRACT_ADDRESSES } from '../config/contracts';
import { ArrowRightLeft, Plus, Play, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { ethers } from 'ethers';

interface SettlementData {
  id: number;
  seller: string;
  buyer: string;
  tokenAmount: string;
  cashAmount: string;
  status: number;
  matchId: string;
  deadline: number;
}

const STATUS_LABELS = ['Pending', 'Settled', 'Failed', 'Cancelled'];
const STATUS_COLORS = [
  'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'bg-red-500/20 text-red-400 border-red-500/30',
  'bg-gray-500/20 text-gray-400 border-gray-500/30',
];

const Settlement: React.FC = () => {
  const { account, contracts } = useWeb3();

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

  const loadSettlements = async () => {
    if (!contracts) return;
    try {
      const count = await contracts.dvpSettlement.settlementCount();
      const items: SettlementData[] = [];
      for (let i = 0; i < Number(count); i++) {
        const s = await contracts.dvpSettlement.settlements(i);
        items.push({
          id: i,
          seller: s.seller,
          buyer: s.buyer,
          tokenAmount: ethers.formatUnits(s.tokenAmount, 18),
          cashAmount: ethers.formatUnits(s.cashAmount, 6),
          status: Number(s.status),
          matchId: s.matchId,
          deadline: Number(s.settlementDeadline),
        });
      }
      setSettlements(items);
    } catch (e) {
      console.error('Load settlements error:', e);
    }
  };

  useEffect(() => {
    loadSettlements();
  }, [contracts]);

  const handleCreate = async () => {
    if (!contracts || !seller || !buyer || !tokenAmount || !cashAmount) return;
    setIsSubmitting(true);
    setTxStatus('Creating settlement…');
    try {
      const deadline = Math.floor(Date.now() / 1000) + Number(deadlineHours) * 3600;
      const matchId = ethers.keccak256(ethers.toUtf8Bytes(`match-${Date.now()}`));
      const tx = await contracts.dvpSettlement.createSettlement(
        seller,
        buyer,
        CONTRACT_ADDRESSES.securityToken,
        ethers.parseUnits(tokenAmount, 18),
        CONTRACT_ADDRESSES.cashToken,
        ethers.parseUnits(cashAmount, 6),
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
      const tx = await contracts.dvpSettlement.executeSettlement(id);
      await tx.wait();
      setTxStatus(`✓ Settlement #${id} executed — DvP atomic swap complete`);
      loadSettlements();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Execute failed'}`);
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
              disabled={isSubmitting || !seller || !buyer || !tokenAmount || !cashAmount}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              Create Settlement
            </button>
          </div>
        </div>
      </div>

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
                  <th className="px-6 py-3 font-medium">ID</th>
                  <th className="px-6 py-3 font-medium">Seller</th>
                  <th className="px-6 py-3 font-medium">Buyer</th>
                  <th className="px-6 py-3 font-medium">Tokens</th>
                  <th className="px-6 py-3 font-medium">Cash</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {settlements.map((s) => (
                  <tr key={s.id} className="hover:bg-white/5 transition-colors">
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">#{s.id}</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">{s.seller.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-300">{s.buyer.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm text-white">{Number(s.tokenAmount).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm text-white">{Number(s.cashAmount).toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_COLORS[s.status]}`}>
                        {STATUS_LABELS[s.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {s.status === 0 && (
                        <div className="flex gap-2">
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
