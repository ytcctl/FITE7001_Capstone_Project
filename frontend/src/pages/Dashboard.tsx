import React, { useEffect, useState } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { CLAIM_TOPICS, CONTRACT_ADDRESSES } from '../config/contracts';
import { TrendingUp, Coins, ShieldCheck, Users, AlertCircle, Activity, CheckCircle2, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { ethers } from 'ethers';

const Dashboard: React.FC = () => {
  const { account, contracts, chainId, roles } = useWeb3();
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

  useEffect(() => {
    if (!contracts || !account) {
      setLoading(false);
      return;
    }
    const load = async () => {
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
    };
    load();
  }, [contracts, account]);

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
      <header>
        <h2 className="text-2xl font-bold text-white">Dashboard</h2>
        <p className="text-gray-400">
          Connected to {account.slice(0, 6)}…{account.slice(-4)} · Chain {chainId}
        </p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={<Coins size={20} />}
          label={`${tokenSymbol} Balance`}
          value={Number(tokenBalance).toLocaleString(undefined, { maximumFractionDigits: 4 })}
          accent="purple"
        />
        <StatCard
          icon={<TrendingUp size={20} />}
          label={`${cashSymbol} Balance`}
          value={Number(cashBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          accent="cyan"
        />
        <StatCard
          icon={<Users size={20} />}
          label="Total Supply"
          value={Number(totalSupply).toLocaleString(undefined, { maximumFractionDigits: 0 })}
          accent="amber"
        />
        <StatCard
          icon={<ShieldCheck size={20} />}
          label="KYC Status"
          value={isVerified ? 'Verified ✓' : isRegistered ? 'Registered' : 'Not Registered'}
          accent={isVerified ? 'emerald' : 'red'}
        />
      </div>

      {/* Token Info + KYC Claims */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token Info */}
        <div className="glass-card p-6">
          <h3 className="font-bold text-white mb-4">Security Token</h3>
          <dl className="space-y-3">
            <InfoRow label="Name" value={tokenName} />
            <InfoRow label="Symbol" value={tokenSymbol} />
            <InfoRow label="Total Supply" value={`${Number(totalSupply).toLocaleString()} ${tokenSymbol}`} />
            <InfoRow label="Your Balance" value={`${Number(tokenBalance).toLocaleString()} ${tokenSymbol}`} />
          </dl>
        </div>

        {/* KYC Claim Status */}
        <div className="glass-card p-6">
          <h3 className="font-bold text-white mb-4">KYC / AML Claims</h3>
          <div className="space-y-3">
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
}> = ({ icon, label, value, accent }) => (
  <div className="glass-card p-6 hover:border-purple-500/30 transition-colors">
    <div className="flex items-center gap-2 mb-2">
      <span className={accentColors[accent] || 'text-gray-400'}>{icon}</span>
      <span className="text-sm text-gray-400 font-medium">{label}</span>
    </div>
    <p className="text-2xl font-bold text-white">{value}</p>
  </div>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between items-center">
    <dt className="text-sm text-gray-400">{label}</dt>
    <dd className="text-sm font-medium text-white">{value}</dd>
  </div>
);

export default Dashboard;
