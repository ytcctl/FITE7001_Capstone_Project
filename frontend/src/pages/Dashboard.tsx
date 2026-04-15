import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { CLAIM_TOPICS, CONTRACT_ADDRESSES, SECURITY_TOKEN_ABI, ORDER_BOOK_ABI, ORDER_BOOK_FACTORY_ABI } from '../config/contracts';
import { Coins, Users, AlertCircle, Activity, CheckCircle2, XCircle, RefreshCw, Loader2, TrendingUp, BarChart3 } from 'lucide-react';
import { ethers } from 'ethers';

interface FactoryToken { name: string; symbol: string; address: string; balance: string; totalSupply: string }
interface MarketInfo { name: string; symbol: string; securityToken: string; orderBook: string; lastPrice: string; tradeCount: number; bestBid: string; bestAsk: string }

const Dashboard: React.FC = () => {
  const { account, contracts, chainId, roles } = useWeb3();
  const navigate = useNavigate();
  const [tokenName, setTokenName] = useState('—');
  const [tokenSymbol, setTokenSymbol] = useState('—');
  const [totalSupply, setTotalSupply] = useState('0');
  const [tokenBalance, setTokenBalance] = useState('0');
  const [cashBalance, setCashBalance] = useState('0');
  const [cashSymbol, setCashSymbol] = useState('THKD');
  const [isVerified, setIsVerified] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [claimStatus, setClaimStatus] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [factoryTokens, setFactoryTokens] = useState<FactoryToken[]>([]);
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [priceMap, setPriceMap] = useState<Record<string, string>>({}); // tokenAddr -> last price

  // System Health state
  interface HealthResult { name: string; passed: boolean; detail: string }
  interface HealthReport { timestamp: bigint; blockNumber: bigint; totalChecks: bigint; passedChecks: bigint; failedChecks: bigint; healthy: boolean }
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [healthResults, setHealthResults] = useState<HealthResult[]>([]);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);

  const runHealthCheck = async () => {
    if (!contracts) return;
    setHealthLoading(true);
    setHealthError(null);
    try {
      const addresses = {
        identityRegistry: CONTRACT_ADDRESSES.identityRegistry,
        compliance: CONTRACT_ADDRESSES.compliance,
        securityToken: CONTRACT_ADDRESSES.securityToken,
        cashToken: CONTRACT_ADDRESSES.cashToken,
        dvpSettlement: CONTRACT_ADDRESSES.dvpSettlement,
        tokenFactory: CONTRACT_ADDRESSES.tokenFactory,
        identityFactory: CONTRACT_ADDRESSES.identityFactory,
        governor: CONTRACT_ADDRESSES.governor,
        timelock: CONTRACT_ADDRESSES.timelock,
        walletRegistry: CONTRACT_ADDRESSES.walletRegistry,
        multiSigWarm: CONTRACT_ADDRESSES.multiSigWarm,
        expectedAdmin: account!,
      };
      const [report, results] = await contracts.systemHealthCheck.fullHealthCheck(addresses);
      setHealthReport(report);
      setHealthResults(results.map((r: any) => ({ name: r.name, passed: r.passed, detail: r.detail })));
    } catch (e: any) {
      setHealthError(e?.reason || e?.message || 'Health check failed');
    } finally {
      setHealthLoading(false);
    }
  };

  const loadDashboard = useCallback(async () => {
    if (!contracts || !account) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [name, symbol, supply, bal, cBal, cSym, verified, registered] = await Promise.all([
        contracts.securityToken.name(),
        contracts.securityToken.symbol(),
        contracts.securityToken.totalSupply(),
        contracts.securityToken.balanceOf(account),
        contracts.cashToken.balanceOf(account),
        contracts.cashToken.symbol(),
        contracts.identityRegistry.isVerified(account),
        contracts.identityRegistry.contains(account),
      ]);
      setTokenName(name);
      setTokenSymbol(symbol);
      setTotalSupply(ethers.formatUnits(supply, 18));
      setTokenBalance(ethers.formatUnits(bal, 18));
      setCashBalance(ethers.formatUnits(cBal, 6));
      setCashSymbol(cSym);
      setIsVerified(verified);
      setIsRegistered(registered);

      // Load claim status
      const claims: Record<number, boolean> = {};
      for (const topic of Object.keys(CLAIM_TOPICS).map(Number)) {
        claims[topic] = await contracts.identityRegistry.hasClaim(account, topic);
      }
      setClaimStatus(claims);
    } catch (e) {
      console.error('Dashboard load error:', e);
    } finally {
      setLoading(false);
    }

    // Load factory-deployed tokens (V1 — EIP-1167 + V2 — ERC-1967)
    try {
      const defaultAddr = (await contracts.securityToken.getAddress()).toLowerCase();
      const provider = (contracts.securityToken as any).runner?.provider ?? contracts.securityToken.runner;
      const seen = new Set<string>([defaultAddr]);
      const tokens: FactoryToken[] = [];

      const fetchFactoryTokens = async (allTokens: any[], addrField: string) => {
        for (const t of allTokens) {
          const addr = (t[addrField] as string).toLowerCase();
          if (seen.has(addr) || !t.active) continue;
          seen.add(addr);
          try {
            const tok = new ethers.Contract(t[addrField], SECURITY_TOKEN_ABI, provider);
            const [bal, supply] = await Promise.all([tok.balanceOf(account), tok.totalSupply()]);
            if (bal > 0n || roles.isAdmin) {
              tokens.push({ name: t.name, symbol: t.symbol, address: t[addrField], balance: ethers.formatUnits(bal, 18), totalSupply: ethers.formatUnits(supply, 18) });
            }
          } catch (e) { console.warn(`Skip factory token ${t.name}:`, e); }
        }
      };

      try { await fetchFactoryTokens(await contracts.tokenFactory.allTokens(), 'tokenAddress'); } catch (e) { console.warn('V1 factory load error:', e); }
      try { await fetchFactoryTokens(await contracts.tokenFactoryV2.allTokens(), 'proxyAddress'); } catch (e) { console.warn('V2 factory load error:', e); }
      setFactoryTokens(tokens);
    } catch (e) { console.warn('Factory token loading failed:', e); }

    // Load market overview (all order books) and build price map
    try {
      const provider = (contracts.securityToken as any).runner?.provider ?? contracts.securityToken.runner;
      const factory = new ethers.Contract(CONTRACT_ADDRESSES.orderBookFactory, ORDER_BOOK_FACTORY_ABI, provider);
      const allMkts: any[] = await factory.activeMarkets();
      const mkts: MarketInfo[] = [];
      const prices: Record<string, string> = {};

      for (const m of allMkts) {
        try {
          const ob = new ethers.Contract(m.orderBook, ORDER_BOOK_ABI, provider);
          const [tc, bid, ask] = await Promise.all([
            ob.tradeCount(),
            ob.bestBid(),
            ob.bestAsk(),
          ]);
          const count = Number(tc);
          let lastPrice = '—';
          if (count > 0) {
            const trade = await ob.getTrade(count - 1);
            lastPrice = ethers.formatUnits(trade.price, 6);
          }
          mkts.push({
            name: m.name,
            symbol: m.symbol,
            securityToken: m.securityToken,
            orderBook: m.orderBook,
            lastPrice,
            tradeCount: count,
            bestBid: Number(bid) > 0 ? ethers.formatUnits(bid, 6) : '—',
            bestAsk: Number(ask) > 0 ? ethers.formatUnits(ask, 6) : '—',
          });
          if (lastPrice !== '—') {
            prices[m.securityToken.toLowerCase()] = lastPrice;
          }
        } catch (e) { console.warn(`Skip market ${m.name}:`, e); }
      }
      // Sort by trade count descending (most active first)
      mkts.sort((a, b) => b.tradeCount - a.tradeCount);
      setMarkets(mkts.slice(0, 10));
      setPriceMap(prices);
    } catch (e) { console.warn('Market overview loading failed:', e); }
  }, [contracts, account]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <AlertCircle size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
        <p className="text-gray-400">
          Connect your wallet to interact with the TokenHub smart contracts on the devnet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="text-gray-400">
            Connected to {account.slice(0, 6)}…{account.slice(-4)} · Chain {chainId}
          </p>
        </div>
        <button onClick={loadDashboard} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          <RefreshCw size={18} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Admin-only Stats */}
      {roles.isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            icon={<Users size={20} />}
            label={`${tokenSymbol} Total Supply`}
            value={Number(totalSupply).toLocaleString(undefined, { maximumFractionDigits: 0 })}
            accent="amber"
            onClick={() => navigate(`/token/${CONTRACT_ADDRESSES.securityToken}`)}
          />
          {factoryTokens.map((ft) => (
            <StatCard
              key={ft.address}
              icon={<Users size={20} />}
              label={`${ft.symbol} Total Supply`}
              value={Number(ft.totalSupply).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              accent="amber"
              onClick={() => navigate(`/token/${ft.address}`)}
            />
          ))}
        </div>
      )}

      {/* Token Holdings + KYC Claims */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Token Holdings */}
        <div className="glass-card p-6">
          <h3 className="font-bold text-white mb-4">My Token Holdings</h3>
          <div className="space-y-3">
            {/* Primary Security Token */}
            {Number(tokenBalance) > 0 && (
            <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm text-gray-400">{tokenName}</p>
                <p className="text-xs text-gray-500">{tokenSymbol}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-white">
                  {Number(tokenBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
                  <span className="text-sm text-gray-400">{tokenSymbol}</span>
                </p>
                {priceMap[CONTRACT_ADDRESSES.securityToken.toLowerCase()] && (
                  <p className="text-xs text-gray-500">Last: {Number(priceMap[CONTRACT_ADDRESSES.securityToken.toLowerCase()]).toLocaleString()} {cashSymbol}</p>
                )}
              </div>
            </div>
            )}
            {/* Cash Token */}
            {Number(cashBalance) > 0 && (
            <div className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <div>
                <p className="text-sm text-gray-400">Cash Token</p>
                <p className="text-xs text-gray-500">{cashSymbol}</p>
              </div>
              <p className="text-lg font-bold text-white">
                {Number(cashBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                <span className="text-sm text-gray-400">{cashSymbol}</span>
              </p>
            </div>
            )}
            {/* Factory-deployed tokens */}
            {factoryTokens.filter((ft) => Number(ft.balance) > 0).map((ft) => (
              <div key={ft.address} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm text-gray-400">{ft.name}</p>
                  <p className="text-xs text-gray-500">{ft.symbol} · {ft.address.slice(0, 8)}…{ft.address.slice(-4)}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-white">
                    {Number(ft.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
                    <span className="text-sm text-gray-400">{ft.symbol}</span>
                  </p>
                  {priceMap[ft.address.toLowerCase()] && (
                    <p className="text-xs text-gray-500">Last: {Number(priceMap[ft.address.toLowerCase()]).toLocaleString()} {cashSymbol}</p>
                  )}
                </div>
              </div>
            ))}
            {factoryTokens.filter((ft) => Number(ft.balance) > 0).length === 0 && Number(tokenBalance) === 0 && Number(cashBalance) === 0 && (
              <p className="text-sm text-gray-500 text-center py-2">No token holdings</p>
            )}
          </div>
        </div>

        {/* KYC Claim Status */}
        <div className="glass-card p-6">
          <h3 className="font-bold text-white mb-4">KYC / AML Claims</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-gray-300">KYC Status</span>
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                  isVerified
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : isRegistered
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                      : 'bg-red-500/20 text-red-400 border-red-500/30'
                }`}
              >
                {isVerified ? 'Verified ✓' : isRegistered ? 'Registered' : 'Not Registered'}
              </span>
            </div>
            {Object.entries(CLAIM_TOPICS).map(([id, name]) => (
              <div key={id} className="flex items-center justify-between">
                <span className="text-sm text-gray-300">{name}</span>
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                    claimStatus[Number(id)]
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-red-500/20 text-red-400 border-red-500/30'
                  }`}
                >
                  {claimStatus[Number(id)] ? 'Active' : 'Missing'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Market Overview — Top 10 Markets */}
      {markets.length > 0 && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={20} className="text-cyan-400" />
            <h3 className="font-bold text-white">Market Overview</h3>
            <span className="text-sm text-gray-500 ml-auto">Top {markets.length} by trade volume</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-gray-400 font-medium py-2 px-3">Market</th>
                  <th className="text-right text-gray-400 font-medium py-2 px-3">Last Price</th>
                  <th className="text-right text-gray-400 font-medium py-2 px-3">Best Bid</th>
                  <th className="text-right text-gray-400 font-medium py-2 px-3">Best Ask</th>
                  <th className="text-right text-gray-400 font-medium py-2 px-3">Trades</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.orderBook} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-3 px-3">
                      <p className="text-white font-medium">{m.name}</p>
                      <p className="text-xs text-gray-500">{m.symbol} · {m.securityToken.slice(0, 8)}…{m.securityToken.slice(-4)}</p>
                    </td>
                    <td className="py-3 px-3 text-right font-medium text-white">{m.lastPrice !== '—' ? `${Number(m.lastPrice).toLocaleString()} ${cashSymbol}` : '—'}</td>
                    <td className="py-3 px-3 text-right text-emerald-400">{m.bestBid !== '—' ? Number(m.bestBid).toLocaleString() : '—'}</td>
                    <td className="py-3 px-3 text-right text-red-400">{m.bestAsk !== '—' ? Number(m.bestAsk).toLocaleString() : '—'}</td>
                    <td className="py-3 px-3 text-right text-gray-300">{m.tradeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* System Health Check — admin/agent only */}
      {(roles.isAdmin || roles.isAgent) && (
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">System Health</h3>
            {healthReport && (
              <span
                className={`ml-2 text-xs font-medium px-2.5 py-1 rounded-full border ${
                  healthReport.healthy
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-red-500/20 text-red-400 border-red-500/30'
                }`}
              >
                {healthReport.healthy ? '● Healthy' : '● Issues Detected'}
              </span>
            )}
          </div>
          <button
            onClick={runHealthCheck}
            disabled={healthLoading}
            className="bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {healthLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Run Health Check
          </button>
        </div>

        {healthError && (
          <div className="text-sm text-red-400 mb-3 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2">
            ✗ {healthError}
          </div>
        )}

        {healthReport && (
          <div className="mb-4 flex items-center gap-6 text-sm text-gray-400">
            <span>Total: <strong className="text-white">{Number(healthReport.totalChecks)}</strong></span>
            <span>Passed: <strong className="text-emerald-400">{Number(healthReport.passedChecks)}</strong></span>
            <span>Failed: <strong className="text-red-400">{Number(healthReport.failedChecks)}</strong></span>
            <span>Block: <strong className="text-gray-300">#{Number(healthReport.blockNumber)}</strong></span>
          </div>
        )}

        {healthResults.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {healthResults.map((r, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-sm ${
                  r.passed
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : 'bg-red-500/5 border-red-500/20'
                }`}
              >
                {r.passed ? (
                  <CheckCircle2 size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <span className={r.passed ? 'text-emerald-300' : 'text-red-300'}>{r.name}</span>
                  <p className="text-gray-500 text-xs mt-0.5">{r.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          !healthLoading && (
            <p className="text-gray-500 text-sm text-center py-4">
              Click "Run Health Check" to verify all on-chain contracts.
            </p>
          )
        )}
      </div>
      )}
    </div>
  );
};

// ── Helper Components ──

const accentColors: Record<string, string> = {
  purple: 'text-purple-400',
  cyan: 'text-cyan-400',
  amber: 'text-amber-400',
  emerald: 'text-emerald-400',
  red: 'text-red-400',
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  onClick?: () => void;
}> = ({ icon, label, value, accent, onClick }) => (
  <div
    className={`glass-card p-6 hover:border-purple-500/30 transition-colors ${onClick ? 'cursor-pointer' : ''}`}
    onClick={onClick}
  >
    <div className="flex items-center gap-2 mb-2">
      <span className={accentColors[accent] || 'text-gray-400'}>{icon}</span>
      <span className="text-sm text-gray-400 font-medium">{label}</span>
    </div>
    <p className="text-2xl font-bold text-white">{value}</p>
  </div>
);

export default Dashboard;
