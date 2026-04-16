import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { CONTRACT_ADDRESSES, SECURITY_TOKEN_ABI, ORDER_BOOK_ABI, ORDER_BOOK_FACTORY_ABI, DVP_SETTLEMENT_ABI } from '../config/contracts';
import { ethers } from 'ethers';
import { ArrowLeft, RefreshCw, Loader2, Coins, Users, Shield, AlertCircle, BarChart3, ArrowRightLeft, Repeat } from 'lucide-react';

interface Shareholder {
  identity: string;
  wallets: string[];
  balance: string;
  verified: boolean;
}

interface TradeRecord { id: number; buyer: string; seller: string; price: string; quantity: string; cashAmount: string; timestamp: number }
interface DvpRecord { id: number; seller: string; buyer: string; tokenAmount: string; cashAmount: string; status: number; timestamp: number }
interface TransferRecord { from: string; to: string; value: string; blockNumber: number }

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
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [dvpRecords, setDvpRecords] = useState<DvpRecord[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [cashSymbol, setCashSymbol] = useState('THKD');

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

      // Load cash symbol
      try { setCashSymbol(await new ethers.Contract(CONTRACT_ADDRESSES.cashToken, ['function symbol() view returns (string)'], provider).symbol()); } catch {}

      // Load last 10 trades from the OrderBook for this token
      try {
        const factory = new ethers.Contract(CONTRACT_ADDRESSES.orderBookFactory, ORDER_BOOK_FACTORY_ABI, provider);
        const obAddr: string = await factory.getOrderBook(address);
        if (obAddr !== ethers.ZeroAddress) {
          const ob = new ethers.Contract(obAddr, ORDER_BOOK_ABI, provider);
          const tc = Number(await ob.tradeCount());
          if (tc > 0) {
            const from = Math.max(0, tc - 10);
            const batch: any[] = await ob.getTradesBatch(from, tc);
            setTrades(batch.map((t: any) => ({
              id: Number(t.id),
              buyer: t.buyer,
              seller: t.seller,
              price: ethers.formatUnits(t.price, 6),
              quantity: ethers.formatUnits(t.quantity, 18),
              cashAmount: ethers.formatUnits(t.cashAmount, 6),
              timestamp: Number(t.timestamp),
            })).reverse());
          }
        }
      } catch (e) { console.warn('Trade loading error:', e); }

      // Load last 10 DvP settlements involving this token
      try {
        const dvp = new ethers.Contract(CONTRACT_ADDRESSES.dvpSettlement, DVP_SETTLEMENT_ABI, provider);
        const sc = Number(await dvp.settlementCount());
        const dvps: DvpRecord[] = [];
        for (let i = sc - 1; i >= 0 && dvps.length < 10; i--) {
          try {
            const s = await dvp.settlements(i);
            if (s.securityToken.toLowerCase() === address.toLowerCase()) {
              dvps.push({
                id: i,
                seller: s.seller,
                buyer: s.buyer,
                tokenAmount: ethers.formatUnits(s.tokenAmount, 18),
                cashAmount: ethers.formatUnits(s.cashAmount, 6),
                status: Number(s.status),
                timestamp: Number(s.tradeTimestamp),
              });
            }
          } catch { break; }
        }
        setDvpRecords(dvps);
      } catch (e) { console.warn('DvP loading error:', e); }

      // Load last 10 Transfer events for this token
      try {
        const tok = new ethers.Contract(address, SECURITY_TOKEN_ABI, provider);
        const filter = tok.filters.Transfer();
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 10000);
        const logs = await tok.queryFilter(filter, fromBlock, currentBlock);
        const recent = logs.slice(-10).reverse();
        setTransfers(recent.map((log: any) => ({
          from: log.args[0],
          to: log.args[1],
          value: ethers.formatUnits(log.args[2], 18),
          blockNumber: log.blockNumber,
        })));
      } catch (e) { console.warn('Transfer log loading error:', e); }
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

          {/* Recent Trades */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={20} className="text-cyan-400" />
              <h3 className="font-bold text-white">Recent Trades</h3>
              <span className="text-sm text-gray-500 ml-auto">Last {trades.length}</span>
            </div>
            {trades.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No trades found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-gray-400 font-medium py-2 px-3">#</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">Buyer</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">Seller</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Price</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Quantity</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Cash Amount</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t) => (
                      <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-3 text-gray-500">{t.id}</td>
                        <td className="py-3 px-3 font-mono text-xs text-emerald-300">{t.buyer.slice(0, 8)}…{t.buyer.slice(-4)}</td>
                        <td className="py-3 px-3 font-mono text-xs text-red-300">{t.seller.slice(0, 8)}…{t.seller.slice(-4)}</td>
                        <td className="py-3 px-3 text-right text-white">{Number(t.price).toLocaleString()} {cashSymbol}</td>
                        <td className="py-3 px-3 text-right text-gray-300">{Number(t.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                        <td className="py-3 px-3 text-right text-gray-300">{Number(t.cashAmount).toLocaleString()} {cashSymbol}</td>
                        <td className="py-3 px-3 text-right text-gray-500 text-xs">{new Date(t.timestamp * 1000).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent DvP Settlements */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Repeat size={20} className="text-amber-400" />
              <h3 className="font-bold text-white">Recent DvP Settlements</h3>
              <span className="text-sm text-gray-500 ml-auto">Last {dvpRecords.length}</span>
            </div>
            {dvpRecords.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No DvP settlements found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-gray-400 font-medium py-2 px-3">ID</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">Seller</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">Buyer</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Tokens</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Cash</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">Status</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dvpRecords.map((d) => {
                      const statusLabels: Record<number, { text: string; cls: string }> = {
                        0: { text: 'Pending', cls: 'text-amber-400' },
                        1: { text: 'Executed', cls: 'text-emerald-400' },
                        2: { text: 'Cancelled', cls: 'text-red-400' },
                        3: { text: 'Failed', cls: 'text-red-400' },
                      };
                      const st = statusLabels[d.status] || { text: 'Unknown', cls: 'text-gray-400' };
                      return (
                        <tr key={d.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="py-3 px-3 text-gray-500">{d.id}</td>
                          <td className="py-3 px-3 font-mono text-xs text-gray-300">{d.seller.slice(0, 8)}…{d.seller.slice(-4)}</td>
                          <td className="py-3 px-3 font-mono text-xs text-gray-300">{d.buyer.slice(0, 8)}…{d.buyer.slice(-4)}</td>
                          <td className="py-3 px-3 text-right text-white">{Number(d.tokenAmount).toLocaleString(undefined, { maximumFractionDigits: 4 })} {tokenSymbol}</td>
                          <td className="py-3 px-3 text-right text-gray-300">{Number(d.cashAmount).toLocaleString()} {cashSymbol}</td>
                          <td className={`py-3 px-3 font-medium ${st.cls}`}>{st.text}</td>
                          <td className="py-3 px-3 text-right text-gray-500 text-xs">{d.timestamp > 0 ? new Date(d.timestamp * 1000).toLocaleString() : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Transfers */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <ArrowRightLeft size={20} className="text-purple-400" />
              <h3 className="font-bold text-white">Recent Transfers</h3>
              <span className="text-sm text-gray-500 ml-auto">Last {transfers.length}</span>
            </div>
            {transfers.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No transfers found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-gray-400 font-medium py-2 px-3">From</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">To</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Amount</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Block</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transfers.map((tr, i) => (
                      <tr key={`${tr.blockNumber}-${i}`} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-3 font-mono text-xs text-gray-300">
                          {tr.from === ethers.ZeroAddress ? <span className="text-emerald-400">Mint</span> : `${tr.from.slice(0, 8)}…${tr.from.slice(-4)}`}
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-gray-300">
                          {tr.to === ethers.ZeroAddress ? <span className="text-red-400">Burn</span> : `${tr.to.slice(0, 8)}…${tr.to.slice(-4)}`}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-white">{Number(tr.value).toLocaleString(undefined, { maximumFractionDigits: 4 })} {tokenSymbol}</td>
                        <td className="py-3 px-3 text-right text-gray-500">#{tr.blockNumber}</td>
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

const DetailCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="glass-card p-4">
    <p className="text-xs text-gray-400 mb-1">{label}</p>
    <p className="text-lg font-bold text-white">{value}</p>
  </div>
);

export default TokenDetail;
