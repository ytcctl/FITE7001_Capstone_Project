import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { CONTRACT_ADDRESSES, SECURITY_TOKEN_ABI } from '../config/contracts';
import { ethers } from 'ethers';
import { ArrowLeft, RefreshCw, Loader2, Coins, Users, Shield, AlertCircle } from 'lucide-react';

interface Shareholder {
  identity: string;
  wallets: string[];
  balance: string;
  verified: boolean;
}

const TokenDetail: React.FC = () => {
  const { address } = useParams<{ address: string }>();
  const navigate = useNavigate();
  const { account, contracts, roles } = useWeb3();

  const [tokenName, setTokenName] = useState('—');
  const [tokenSymbol, setTokenSymbol] = useState('—');
  const [totalSupply, setTotalSupply] = useState('0');
  const [maxSupply, setMaxSupply] = useState('0');
  const [mintThreshold, setMintThreshold] = useState('0');
  const [maxShareholders, setMaxShareholders] = useState('0');
  const [shareholderCount, setShareholderCount] = useState(0);
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPrimary, setIsPrimary] = useState(false);

  const loadTokenDetail = useCallback(async () => {
    if (!address || !contracts || !account) return;
    setLoading(true);
    try {
      const provider = (contracts.securityToken as any).runner?.provider ?? contracts.securityToken.runner;
      const tok = new ethers.Contract(address, SECURITY_TOKEN_ABI, provider);
      const primary = address.toLowerCase() === CONTRACT_ADDRESSES.securityToken.toLowerCase();
      setIsPrimary(primary);

      const [name, symbol, supply] = await Promise.all([
        tok.name(),
        tok.symbol(),
        tok.totalSupply(),
      ]);
      setTokenName(name);
      setTokenSymbol(symbol);
      setTotalSupply(ethers.formatUnits(supply, 18));

      // These may not exist on all token contracts, so try-catch each
      try { setMaxSupply(ethers.formatUnits(await tok.maxSupply(), 18)); } catch { setMaxSupply('0'); }
      try { setMintThreshold(ethers.formatUnits(await tok.mintThreshold(), 18)); } catch { setMintThreshold('0'); }
      try { setMaxShareholders(String(await tok.maxShareholders())); } catch { setMaxShareholders('0'); }

      // Load shareholders via identity holders
      try {
        const identityHolders: string[] = await tok.getIdentityHolders();
        setShareholderCount(identityHolders.length);

        const holders: Shareholder[] = [];
        for (const idAddr of identityHolders) {
          try {
            const wallets: string[] = await contracts.identityRegistry.getLinkedWallets(idAddr);
            let totalBal = 0n;
            let verified = false;
            for (const w of wallets) {
              totalBal += await tok.balanceOf(w);
              if (!verified) {
                try { verified = await contracts.identityRegistry.isVerified(w); } catch {}
              }
            }
            holders.push({
              identity: idAddr,
              wallets,
              balance: ethers.formatUnits(totalBal, 18),
              verified,
            });
          } catch {
            holders.push({ identity: idAddr, wallets: [], balance: '0', verified: false });
          }
        }
        // Sort by balance descending
        holders.sort((a, b) => Number(b.balance) - Number(a.balance));
        setShareholders(holders);
      } catch {
        setShareholderCount(0);
        setShareholders([]);
      }
    } catch (e) {
      console.error('TokenDetail load error:', e);
    } finally {
      setLoading(false);
    }
  }, [address, contracts, account]);

  useEffect(() => {
    loadTokenDetail();
  }, [loadTokenDetail]);

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <AlertCircle size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
      </div>
    );
  }

  if (!roles.isAdmin) {
    return (
      <div className="glass-card p-12 text-center">
        <Shield size={48} className="mx-auto mb-4 text-red-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Admin Only</h2>
        <p className="text-gray-400">This page is restricted to administrators.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          title="Back to Dashboard"
        >
          <ArrowLeft size={20} className="text-gray-400" />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-white">{tokenName}</h2>
          <p className="text-gray-400 text-sm font-mono">{address}</p>
        </div>
        <button onClick={loadTokenDetail} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          <RefreshCw size={18} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {loading ? (
        <div className="glass-card p-12 text-center">
          <Loader2 size={32} className="mx-auto animate-spin text-purple-400" />
          <p className="text-gray-400 mt-3">Loading token details…</p>
        </div>
      ) : (
        <>
          {/* Token Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <DetailCard label="Symbol" value={tokenSymbol} />
            <DetailCard label="Total Supply" value={`${Number(totalSupply).toLocaleString()}`} />
            <DetailCard label="Max Supply" value={Number(maxSupply) > 0 ? Number(maxSupply).toLocaleString() : 'Unlimited'} />
            <DetailCard label="Mint Threshold" value={Number(mintThreshold) > 0 ? Number(mintThreshold).toLocaleString() : 'Disabled'} />
            <DetailCard label="Max Shareholders" value={Number(maxShareholders) > 0 ? Number(maxShareholders).toLocaleString() : 'Unlimited'} />
            <DetailCard label="Current Shareholders" value={String(shareholderCount)} />
          </div>

          {/* Shareholders List */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users size={20} className="text-purple-400" />
              <h3 className="font-bold text-white">Shareholders</h3>
              <span className="text-sm text-gray-400 ml-auto">{shareholderCount} identities</span>
            </div>

            {shareholders.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No shareholders found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-gray-400 font-medium py-2 px-3">#</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">Identity Contract</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">Linked Wallets</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">KYC Status</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Balance</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">% of Supply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shareholders.map((sh, i) => {
                      const pct = Number(totalSupply) > 0
                        ? ((Number(sh.balance) / Number(totalSupply)) * 100).toFixed(2)
                        : '0.00';
                      return (
                        <tr key={sh.identity} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-3 text-gray-500">{i + 1}</td>
                          <td className="py-3 px-3">
                            <span className="font-mono text-xs text-purple-300">{sh.identity.slice(0, 10)}…{sh.identity.slice(-6)}</span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex flex-col gap-0.5">
                              {sh.wallets.map((w) => (
                                <span key={w} className="font-mono text-xs text-gray-400">{w.slice(0, 10)}…{w.slice(-4)}</span>
                              ))}
                              {sh.wallets.length === 0 && <span className="text-xs text-gray-600">—</span>}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`text-xs font-medium px-2.5 py-1 rounded-full border ${
                                sh.verified
                                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                                  : 'bg-red-500/20 text-red-400 border-red-500/30'
                              }`}
                            >
                              {sh.verified ? 'Verified ✓' : 'Not Verified'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-medium text-white">
                            {Number(sh.balance).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                          </td>
                          <td className="py-3 px-3 text-right text-gray-400">{pct}%</td>
                        </tr>
                      );
                    })}
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

const DetailCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="glass-card p-4">
    <p className="text-xs text-gray-400 mb-1">{label}</p>
    <p className="text-lg font-bold text-white">{value}</p>
  </div>
);

export default TokenDetail;
