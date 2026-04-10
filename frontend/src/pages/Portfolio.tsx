import React, { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { CLAIM_TOPICS } from '../config/contracts';
import { Briefcase, Send, RefreshCw, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { ethers } from 'ethers';

const Portfolio: React.FC = () => {
  const { account, contracts } = useWeb3();

  const [tokenBalance, setTokenBalance] = useState('0');
  const [cashBalance, setCashBalance] = useState('0');
  const [tokenSymbol, setTokenSymbol] = useState('HKSAT');
  const [cashSymbol, setCashSymbol] = useState('THKD');
  const [isVerified, setIsVerified] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [country, setCountry] = useState('');
  const [claims, setClaims] = useState<Record<number, boolean>>({});
  const [isFrozen, setIsFrozen] = useState(false);
  const [isSafeListed, setIsSafeListed] = useState(false);

  // Transfer
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferType, setTransferType] = useState<'security' | 'cash'>('security');

  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadPortfolio = async () => {
    if (!contracts || !account) return;
    try {
      const [bal, cBal, sym, cSym, verified, registered, ctry, frozen, safe] = await Promise.all([
        contracts.securityToken.balanceOf(account),
        contracts.cashToken.balanceOf(account),
        contracts.securityToken.symbol(),
        contracts.cashToken.symbol(),
        contracts.identityRegistry.isVerified(account),
        contracts.identityRegistry.contains(account),
        contracts.identityRegistry.investorCountry(account),
        contracts.securityToken.frozen(account),
        contracts.securityToken.safeListed(account),
      ]);
      setTokenBalance(ethers.formatUnits(bal, 18));
      setCashBalance(ethers.formatUnits(cBal, 6));
      setTokenSymbol(sym);
      setCashSymbol(cSym);
      setIsVerified(verified);
      setIsRegistered(registered);
      setCountry(ctry);
      setIsFrozen(frozen);
      setIsSafeListed(safe);

      const c: Record<number, boolean> = {};
      for (const t of [1, 2, 3, 4, 5]) {
        c[t] = await contracts.identityRegistry.hasClaim(account, t);
      }
      setClaims(c);
    } catch (e) {
      console.error('Portfolio load error:', e);
    }
  };

  useEffect(() => {
    loadPortfolio();
  }, [contracts, account]);

  const handleTransfer = async () => {
    if (!contracts || !transferTo || !transferAmount) return;
    setIsSubmitting(true);
    const token = transferType === 'security' ? 'securityToken' : 'cashToken';
    const decimals = transferType === 'security' ? 18 : 6;
    const sym = transferType === 'security' ? tokenSymbol : cashSymbol;
    setTxStatus(`Transferring ${transferAmount} ${sym}…`);
    try {
      const tx = await contracts[token].transfer(transferTo, ethers.parseUnits(transferAmount, decimals));
      await tx.wait();
      setTxStatus(`✓ Transferred ${transferAmount} ${sym} to ${transferTo.slice(0, 10)}…`);
      setTransferAmount('');
      loadPortfolio();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Transfer failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <Briefcase size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Portfolio</h2>
        <p className="text-gray-400">Connect your wallet to view your holdings and transfer tokens.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Portfolio</h2>
          <p className="text-gray-400">Your token holdings, identity status, and transfer capability.</p>
        </div>
        <button onClick={loadPortfolio} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
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

      {/* Holdings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <p className="text-sm text-gray-400 mb-1">Security Token</p>
          <p className="text-3xl font-bold text-white">
            {Number(tokenBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
            <span className="text-lg text-gray-400">{tokenSymbol}</span>
          </p>
        </div>
        <div className="glass-card p-6">
          <p className="text-sm text-gray-400 mb-1">Cash Token</p>
          <p className="text-3xl font-bold text-white">
            {Number(cashBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
            <span className="text-lg text-gray-400">{cashSymbol}</span>
          </p>
        </div>
      </div>

      {/* Identity Status */}
      <div className="glass-card p-6">
        <h3 className="font-bold text-white mb-4">Identity & Compliance Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <StatusPill label="Registered" ok={isRegistered} />
          <StatusPill label="Verified" ok={isVerified} />
          <StatusPill label="Frozen" ok={!isFrozen} okText="No" failText="Yes" />
          <StatusPill label="Safe-Listed" ok={isSafeListed} okText="Yes" failText="No" />
        </div>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm text-gray-400">Country:</span>
          <span className="text-sm font-medium text-white">{country || '—'}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {Object.entries(CLAIM_TOPICS).map(([id, name]) => (
            <div key={id} className="flex items-center gap-2 text-sm">
              {claims[Number(id)] ? (
                <CheckCircle size={14} className="text-emerald-400 shrink-0" />
              ) : (
                <XCircle size={14} className="text-red-400 shrink-0" />
              )}
              <span className="text-gray-300 truncate">{name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Transfer */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Send size={20} className="text-purple-400" />
          <h3 className="font-bold text-white">Transfer Tokens</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Token Type</label>
            <select
              value={transferType}
              onChange={(e) => setTransferType(e.target.value as 'security' | 'cash')}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            >
              <option value="security" className="bg-slate-800">{tokenSymbol} (Security)</option>
              <option value="cash" className="bg-slate-800">{cashSymbol} (Cash)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Recipient Address</label>
            <input
              type="text"
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
              placeholder="0x…"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Amount</label>
            <input
              type="text"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              placeholder="0.0"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleTransfer}
              disabled={isSubmitting || !transferTo || !transferAmount}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              Transfer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Helper ──
const StatusPill: React.FC<{
  label: string;
  ok: boolean;
  okText?: string;
  failText?: string;
}> = ({ label, ok, okText = 'Yes', failText = 'No' }) => (
  <div className="flex items-center gap-2">
    <span className="text-sm text-gray-400">{label}:</span>
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
        ok
          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
          : 'bg-red-500/20 text-red-400 border-red-500/30'
      }`}
    >
      {ok ? okText : failText}
    </span>
  </div>
);

export default Portfolio;
