import React, { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { CLAIM_TOPICS, SECURITY_TOKEN_ABI } from '../config/contracts';
import { Briefcase, Send, RefreshCw, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { ethers } from 'ethers';

interface FactoryHolding { name: string; symbol: string; address: string; balance: string; decimals: number }

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
  const [factoryHoldings, setFactoryHoldings] = useState<FactoryHolding[]>([]);

  // Transfer
  const [transferTo, setTransferTo] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferType, setTransferType] = useState<string>('security');

  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadPortfolio = async () => {
    if (!contracts || !account) return;

    // Load default token balances & identity status
    try {
      const [bal, cBal, sym, cSym, verified, registered, ctry, frozen] = await Promise.all([
        contracts.securityToken.balanceOf(account),
        contracts.cashToken.balanceOf(account),
        contracts.securityToken.symbol(),
        contracts.cashToken.symbol(),
        contracts.identityRegistry.isVerified(account),
        contracts.identityRegistry.contains(account),
        contracts.identityRegistry.investorCountry(account),
        contracts.securityToken.frozen(account),
      ]);
      setTokenBalance(ethers.formatUnits(bal, 18));
      setCashBalance(ethers.formatUnits(cBal, 6));
      setTokenSymbol(sym);
      setCashSymbol(cSym);
      setIsVerified(verified);
      setIsRegistered(registered);
      setCountry(ctry);
      setIsFrozen(frozen);

      const c: Record<number, boolean> = {};
      for (const t of Object.keys(CLAIM_TOPICS).map(Number)) {
        c[t] = await contracts.identityRegistry.hasClaim(account, t);
      }
      setClaims(c);
    } catch (e) {
      console.error('Portfolio load error:', e);
    }

    // Load factory-deployed tokens (V1 — EIP-1167 + V2 — ERC-1967)
    // Runs independently so factory tokens still appear even if identity checks above fail
    try {
      const defaultAddr = (await contracts.securityToken.getAddress()).toLowerCase();
      const provider = (contracts.securityToken as any).runner?.provider ?? contracts.securityToken.runner;
      const seen = new Set<string>([defaultAddr]);
      const holdings: FactoryHolding[] = [];

      const fetchHoldings = async (allTokens: any[], addrField: string) => {
        for (const t of allTokens) {
          const addr = (t[addrField] as string).toLowerCase();
          if (seen.has(addr) || !t.active) continue;
          seen.add(addr);
          try {
            const tok = new ethers.Contract(t[addrField], SECURITY_TOKEN_ABI, provider);
            const b = await tok.balanceOf(account);
            if (b > 0n) {
              holdings.push({ name: t.name, symbol: t.symbol, address: t[addrField], balance: ethers.formatUnits(b, 18), decimals: 18 });
            }
          } catch (e) { console.warn(`Skip factory token ${t.name}:`, e); }
        }
      };

      try { await fetchHoldings(await contracts.tokenFactory.allTokens(), 'tokenAddress'); } catch (e) { console.warn('V1 factory load error:', e); }
      try { await fetchHoldings(await contracts.tokenFactoryV2.allTokens(), 'proxyAddress'); } catch (e) { console.warn('V2 factory load error:', e); }
      setFactoryHoldings(holdings);
    } catch (e) { console.warn('Factory token loading failed:', e); }
  };

  useEffect(() => {
    loadPortfolio();
  }, [contracts, account]);

  const handleTransfer = async () => {
    if (!contracts || !transferTo || !transferAmount) return;
    let to: string;
    try { to = ethers.getAddress(transferTo.trim()); } catch { setTxStatus('✗ Invalid recipient address'); return; }
    setIsSubmitting(true);
    try {
      let tokenContract: ethers.Contract;
      let decimals: number;
      let sym: string;

      if (transferType === 'security') {
        tokenContract = contracts.securityToken;
        decimals = 18;
        sym = tokenSymbol;
      } else if (transferType === 'cash') {
        tokenContract = contracts.cashToken;
        decimals = 6;
        sym = cashSymbol;
      } else {
        // Factory-deployed token (transferType is the address)
        const holding = factoryHoldings.find(h => h.address === transferType);
        if (!holding) return;
        const provider = (contracts.securityToken as any).runner ?? contracts.securityToken.runner;
        tokenContract = new ethers.Contract(holding.address, SECURITY_TOKEN_ABI, provider);
        decimals = holding.decimals;
        sym = holding.symbol;
      }

      setTxStatus(`Transferring ${transferAmount} ${sym}…`);
      const tx = await tokenContract.transfer(to, ethers.parseUnits(transferAmount, decimals));
      await tx.wait();
      setTxStatus(`✓ Transferred ${transferAmount} ${sym} to ${to.slice(0, 10)}…`);
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
        {factoryHoldings.map((fh) => (
          <div key={fh.address} className="glass-card p-6">
            <p className="text-sm text-gray-400 mb-1">{fh.name}</p>
            <p className="text-3xl font-bold text-white">
              {Number(fh.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
              <span className="text-lg text-gray-400">{fh.symbol}</span>
            </p>
            <p className="text-xs text-gray-500 mt-1">{fh.address.slice(0, 10)}…{fh.address.slice(-4)}</p>
          </div>
        ))}
      </div>

      {/* Identity Status */}
      <div className="glass-card p-6">
        <h3 className="font-bold text-white mb-4">Identity & Compliance Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          <StatusPill label="Registered" ok={isRegistered} />
          <StatusPill label="Verified" ok={isVerified} />
          <StatusPill label="Frozen" ok={!isFrozen} okText="No" failText="Yes" />
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
              onChange={(e) => setTransferType(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
            >
              <option value="security" className="bg-slate-800">{tokenSymbol} (Security)</option>
              <option value="cash" className="bg-slate-800">{cashSymbol} (Cash)</option>
              {factoryHoldings.map((fh) => (
                <option key={fh.address} value={fh.address} className="bg-slate-800">{fh.symbol} ({fh.name})</option>
              ))}
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
