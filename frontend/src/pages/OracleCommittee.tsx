import React, { useState, useEffect, useCallback } from 'react';
import { useWeb3 } from '../context/Web3Context';
import {
  Users,
  PlusCircle,
  Trash2,
  Settings2,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldAlert,
  Hash,
  RefreshCw,
} from 'lucide-react';

const OracleCommittee: React.FC = () => {
  const { contracts, account } = useWeb3();

  // State
  const [members, setMembers] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(0);
  const [maxOracles, setMaxOracles] = useState(5);
  const [isLoading, setIsLoading] = useState(true);

  // Forms
  const [addAddress, setAddAddress] = useState('');
  const [removeAddress, setRemoveAddress] = useState('');
  const [newThreshold, setNewThreshold] = useState('');

  // Status
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  /** Load oracle committee state */
  const loadData = useCallback(async () => {
    if (!contracts) return;
    setIsLoading(true);
    try {
      const [mems, thresh, maxO] = await Promise.all([
        contracts.oracleCommittee.oracleMembers(),
        contracts.oracleCommittee.threshold(),
        contracts.oracleCommittee.MAX_ORACLES(),
      ]);
      setMembers([...mems]);
      setThreshold(Number(thresh));
      setMaxOracles(Number(maxO));
    } catch (err) {
      console.error('Failed to load oracle committee data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [contracts]);

  useEffect(() => { loadData(); }, [loadData]);

  /** Add a new oracle member */
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contracts || !addAddress) return;
    setIsSubmitting(true);
    setStatus(null);
    try {
      const tx = await contracts.oracleCommittee.addOracle(addAddress);
      await tx.wait();
      setStatus({ type: 'success', msg: `✓ Oracle member added: ${addAddress}` });
      setAddAddress('');
      loadData();
    } catch (err: unknown) {
      const error = err as Error;
      setStatus({ type: 'error', msg: error.message || 'Failed to add oracle' });
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Remove an oracle member */
  const handleRemove = async (address: string) => {
    if (!contracts) return;
    setIsSubmitting(true);
    setStatus(null);
    try {
      const tx = await contracts.oracleCommittee.removeOracle(address);
      await tx.wait();
      setStatus({ type: 'success', msg: `✓ Oracle member removed: ${address}` });
      setRemoveAddress('');
      loadData();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message?.includes('would go below threshold')) {
        setStatus({ type: 'error', msg: 'Cannot remove: would go below the signature threshold.' });
      } else {
        setStatus({ type: 'error', msg: error.message || 'Failed to remove oracle' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  /** Update threshold */
  const handleSetThreshold = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contracts || !newThreshold) return;
    setIsSubmitting(true);
    setStatus(null);
    try {
      const tx = await contracts.oracleCommittee.setThreshold(Number(newThreshold));
      await tx.wait();
      setStatus({ type: 'success', msg: `✓ Threshold updated to ${newThreshold}` });
      setNewThreshold('');
      loadData();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message?.includes('threshold must be >=2')) {
        setStatus({ type: 'error', msg: 'Threshold must be at least 2.' });
      } else if (error.message?.includes('threshold > members')) {
        setStatus({ type: 'error', msg: 'Threshold cannot exceed the number of oracle members.' });
      } else {
        setStatus({ type: 'error', msg: error.message || 'Failed to set threshold' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <ShieldAlert className="text-orange-400" size={32} />
          Oracle Committee
        </h1>
        <p className="text-gray-400 mt-2">
          Manage the multi-oracle compliance attestation verifier. Transfers require{' '}
          <strong className="text-white">{threshold}-of-{members.length}</strong>{' '}
          oracle signatures to pass compliance checks, eliminating single-point-of-failure risk.
        </p>
      </div>

      {/* Status banner */}
      {status && (
        <div className={`rounded-xl p-3 text-sm flex items-center gap-2 ${
          status.type === 'success'
            ? 'bg-green-500/10 border border-green-500/20 text-green-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {status.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          {status.msg}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm text-gray-400 mb-1">Oracle Members</p>
          <p className="text-2xl font-bold text-white">{members.length} / {maxOracles}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm text-gray-400 mb-1">Signature Threshold</p>
          <p className="text-2xl font-bold text-orange-400">{threshold}-of-{members.length}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
          <p className="text-sm text-gray-400 mb-1">Security Level</p>
          <p className="text-2xl font-bold text-green-400">
            {threshold >= 2 ? 'Multi-Sig' : 'Single-Sig'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {threshold >= 2
              ? `${threshold - 1} oracle(s) can be compromised without risk`
              : 'Single point of failure — increase threshold'}
          </p>
        </div>
      </div>

      {/* Oracle Members List */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Users size={20} className="text-blue-400" />
          Oracle Members
          <button
            onClick={loadData}
            className="ml-auto p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="animate-spin mr-2" size={20} />
            Loading oracle members…
          </div>
        ) : members.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No oracle members found.</p>
        ) : (
          <div className="space-y-2">
            {members.map((member, index) => (
              <div
                key={member}
                className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white text-xs font-bold">
                    {index + 1}
                  </div>
                  <span className="font-mono text-white text-sm">{member}</span>
                  {member.toLowerCase() === account?.toLowerCase() && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400">
                      YOU
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleRemove(member)}
                  disabled={isSubmitting || members.length <= threshold}
                  className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed"
                  title={members.length <= threshold
                    ? 'Cannot remove: would go below threshold'
                    : `Remove ${shortAddr(member)}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Oracle + Set Threshold */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Add Oracle Member */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <PlusCircle size={20} className="text-green-400" />
            Add Oracle Member
          </h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Oracle Address
              </label>
              <input
                type="text"
                value={addAddress}
                onChange={(e) => setAddAddress(e.target.value)}
                placeholder="0x…"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 transition font-mono text-sm"
                required
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting || !addAddress || members.length >= maxOracles}
              className="w-full px-4 py-3 bg-gradient-to-r from-orange-600 to-amber-600 text-white font-medium rounded-xl hover:from-orange-500 hover:to-amber-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <><Loader2 size={18} className="animate-spin" /> Adding…</>
              ) : (
                <><PlusCircle size={18} /> Add Oracle</>
              )}
            </button>
            {members.length >= maxOracles && (
              <p className="text-xs text-yellow-400">Maximum oracles ({maxOracles}) reached.</p>
            )}
          </form>
        </div>

        {/* Set Threshold */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Settings2 size={20} className="text-purple-400" />
            Set Signature Threshold
          </h2>
          <form onSubmit={handleSetThreshold} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                New Threshold (min 2, max {members.length})
              </label>
              <input
                type="number"
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                placeholder={`Current: ${threshold}`}
                min={2}
                max={members.length}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition"
                required
              />
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-sm text-blue-300 flex items-start gap-2">
              <Hash size={16} className="mt-0.5 shrink-0" />
              <span>
                The threshold determines how many oracle signatures are required to
                verify a compliance attestation. A higher threshold increases security
                but requires more oracles to be online.
              </span>
            </div>
            <button
              type="submit"
              disabled={isSubmitting || !newThreshold}
              className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-xl hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <><Loader2 size={18} className="animate-spin" /> Updating…</>
              ) : (
                <><Settings2 size={18} /> Update Threshold</>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default OracleCommittee;
