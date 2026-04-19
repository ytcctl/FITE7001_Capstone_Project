import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWeb3 } from '../context/Web3Context';
import { CONTRACT_ADDRESSES, CASH_TOKEN_ABI } from '../config/contracts';
import { ethers } from 'ethers';
import { ArrowLeft, RefreshCw, Loader2, DollarSign, AlertCircle, ArrowRightLeft, Users } from 'lucide-react';

interface TransferRecord { from: string; to: string; value: string; blockNumber: number }
interface HolderInfo { address: string; balance: string; pct: string }

const CashTokenDetail: React.FC = () => {
  const navigate = useNavigate();
  const { account, contracts } = useWeb3();

  const [tokenName, setTokenName] = useState('—');
  const [tokenSymbol, setTokenSymbol] = useState('—');
  const [decimals, setDecimals] = useState(6);
  const [totalSupply, setTotalSupply] = useState('0');
  const [myBalance, setMyBalance] = useState('0');
  const [owner, setOwner] = useState('—');
  const [loading, setLoading] = useState(true);
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [holders, setHolders] = useState<HolderInfo[]>([]);

  const loadDetail = useCallback(async () => {
    if (!contracts || !account) return;
    setLoading(true);
    try {
      const provider = (contracts.cashToken as any).runner?.provider ?? contracts.cashToken.runner;
      const tok = new ethers.Contract(CONTRACT_ADDRESSES.cashToken, CASH_TOKEN_ABI, provider);

      const [name, sym, dec, supply, bal] = await Promise.all([
        tok.name(),
        tok.symbol(),
        tok.decimals(),
        tok.totalSupply(),
        tok.balanceOf(account),
      ]);
      const d = Number(dec);
      setTokenName(name);
      setTokenSymbol(sym);
      setDecimals(d);
      setTotalSupply(ethers.formatUnits(supply, d));
      setMyBalance(ethers.formatUnits(bal, d));

      try { setOwner(await tok.owner()); } catch { setOwner('—'); }

      // Load recent Transfer events and derive known holders
      try {
        const filter = tok.filters.Transfer();
        const currentBlock = await provider.getBlockNumber();
        const fromBlock = Math.max(0, currentBlock - 50000);
        const logs = await tok.queryFilter(filter, fromBlock, currentBlock);

        // Collect unique addresses from transfer events
        const addrSet = new Set<string>();
        for (const log of logs) {
          const args = (log as any).args;
          if (args[0] !== ethers.ZeroAddress) addrSet.add(args[0]);
          if (args[1] !== ethers.ZeroAddress) addrSet.add(args[1]);
        }

        // Fetch balances for discovered addresses
        const supplyNum = Number(ethers.formatUnits(supply, d));
        const holderList: HolderInfo[] = [];
        for (const addr of addrSet) {
          try {
            const b = await tok.balanceOf(addr);
            if (b > 0n) {
              const balFormatted = ethers.formatUnits(b, d);
              holderList.push({
                address: addr,
                balance: balFormatted,
                pct: supplyNum > 0 ? ((Number(balFormatted) / supplyNum) * 100).toFixed(2) : '0.00',
              });
            }
          } catch { /* skip */ }
        }
        holderList.sort((a, b) => Number(b.balance) - Number(a.balance));
        setHolders(holderList);

        // Recent transfers (last 20)
        const recent = logs.slice(-20).reverse();
        setTransfers(recent.map((log: any) => ({
          from: log.args[0],
          to: log.args[1],
          value: ethers.formatUnits(log.args[2], d),
          blockNumber: log.blockNumber,
        })));
      } catch (e) { console.warn('Transfer log loading error:', e); }
    } catch (e) {
      console.error('CashTokenDetail load error:', e);
    } finally {
      setLoading(false);
    }
  }, [contracts, account]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <AlertCircle size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Connect Your Wallet</h2>
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
          <div className="flex items-center gap-2">
            <DollarSign size={24} className="text-emerald-400" />
            <h2 className="text-2xl font-bold text-white">{tokenName}</h2>
          </div>
          <p className="text-gray-400 text-sm font-mono">{CONTRACT_ADDRESSES.cashToken}</p>
        </div>
        <button onClick={loadDetail} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          <RefreshCw size={18} className={`text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {loading ? (
        <div className="glass-card p-12 text-center">
          <Loader2 size={32} className="mx-auto animate-spin text-purple-400" />
          <p className="text-gray-400 mt-3">Loading cash token details…</p>
        </div>
      ) : (
        <>
          {/* Token Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <DetailCard label="Symbol" value={tokenSymbol} />
            <DetailCard label="Decimals" value={String(decimals)} />
            <DetailCard label="Total Supply" value={`${Number(totalSupply).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}`} />
            <DetailCard label="My Balance" value={`${Number(myBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tokenSymbol}`} />
          </div>

          {/* Owner */}
          {owner !== '—' && (
            <div className="glass-card p-4">
              <p className="text-xs text-gray-400 mb-1">Contract Owner</p>
              <p className="text-sm font-mono text-purple-300">{owner}</p>
            </div>
          )}

          {/* Holders */}
          <div className="glass-card p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users size={20} className="text-emerald-400" />
              <h3 className="font-bold text-white">Known Holders</h3>
              <span className="text-sm text-gray-400 ml-auto">{holders.length} addresses</span>
            </div>
            {holders.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No holders found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left text-gray-400 font-medium py-2 px-3">#</th>
                      <th className="text-left text-gray-400 font-medium py-2 px-3">Address</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">Balance</th>
                      <th className="text-right text-gray-400 font-medium py-2 px-3">% of Supply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holders.map((h, i) => (
                      <tr key={h.address} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="py-3 px-3 text-gray-500">{i + 1}</td>
                        <td className="py-3 px-3 font-mono text-xs text-gray-300">
                          {h.address === account ? (
                            <span className="text-purple-300">{h.address.slice(0, 10)}…{h.address.slice(-6)} <span className="text-xs text-purple-500">(you)</span></span>
                          ) : (
                            `${h.address.slice(0, 10)}…${h.address.slice(-6)}`
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-white">
                          {Number(h.balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} {tokenSymbol}
                        </td>
                        <td className="py-3 px-3 text-right text-gray-400">{h.pct}%</td>
                      </tr>
                    ))}
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
                        <td className="py-3 px-3 text-right font-medium text-white">
                          {Number(tr.value).toLocaleString(undefined, { maximumFractionDigits: 2 })} {tokenSymbol}
                        </td>
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

export default CashTokenDetail;
