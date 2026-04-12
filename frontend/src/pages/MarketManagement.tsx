import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../context/Web3Context';
import { SECURITY_TOKEN_ABI } from '../config/contracts';
import {
  PlusCircle,
  BarChart3,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Power,
  PowerOff,
  ExternalLink,
  AlertTriangle,
  Store,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FactoryToken {
  name: string;
  symbol: string;
  tokenAddress: string;
  createdBy: string;
  createdAt: number;
  active: boolean;
}

interface MarketInfo {
  securityToken: string;
  orderBook: string;
  name: string;
  symbol: string;
  createdAt: bigint;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MarketManagement: React.FC = () => {
  const { contracts, account, provider } = useWeb3();

  // All markets from factory
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);

  // Tokens from TokenFactory (for the "create market" picker)
  const [tokens, setTokens] = useState<FactoryToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);

  // Create market form
  const [selectedTokenAddr, setSelectedTokenAddr] = useState('');
  const [customName, setCustomName] = useState('');
  const [customSymbol, setCustomSymbol] = useState('');
  const [secDecimals, setSecDecimals] = useState('18');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSuccess, setCreateSuccess] = useState('');

  // Toggle (deactivate / reactivate) state
  const [toggling, setToggling] = useState<number | null>(null);

  // Set of security-token addresses that already have a market
  const [marketsMap, setMarketsMap] = useState<Set<string>>(new Set());

  // ---------------------------------------------------------------------------
  // Load all markets
  // ---------------------------------------------------------------------------

  const loadMarkets = useCallback(async () => {
    if (!contracts?.orderBookFactory) {
      setMarketsLoading(false);
      return;
    }
    try {
      const all = (await contracts.orderBookFactory.allMarkets()) as MarketInfo[];
      setMarkets(all);
      const map = new Set<string>();
      all.forEach((m) => map.add(m.securityToken.toLowerCase()));
      setMarketsMap(map);
    } catch (err) {
      console.error('[MarketMgmt] loadMarkets error:', err);
    } finally {
      setMarketsLoading(false);
    }
  }, [contracts]);

  // ---------------------------------------------------------------------------
  // Load tokens from TokenFactory
  // ---------------------------------------------------------------------------

  const loadTokens = useCallback(async () => {
    if (!contracts?.tokenFactory || !provider) {
      setTokensLoading(false);
      return;
    }
    try {
      const all = (await contracts.tokenFactory.allTokens()) as FactoryToken[];
      setTokens(all.filter((t) => t.active));
    } catch (err) {
      console.error('[MarketMgmt] loadTokens error:', err);
    } finally {
      setTokensLoading(false);
    }
  }, [contracts, provider]);

  useEffect(() => {
    loadMarkets();
    loadTokens();
  }, [loadMarkets, loadTokens]);

  // ---------------------------------------------------------------------------
  // Auto-fill name + symbol when a token is picked
  // ---------------------------------------------------------------------------

  const handleTokenSelect = (addr: string) => {
    setSelectedTokenAddr(addr);
    setCreateError('');
    setCreateSuccess('');
    const token = tokens.find((t) => t.tokenAddress === addr);
    if (token) {
      setCustomSymbol(token.symbol);
      setCustomName(`${token.symbol} / HKD`);
    }
  };

  // ---------------------------------------------------------------------------
  // Create OrderBook market
  // ---------------------------------------------------------------------------

  const handleCreateMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreateSuccess('');

    if (!contracts?.orderBookFactory || !account) {
      setCreateError('Connect admin wallet first');
      return;
    }
    if (!selectedTokenAddr) {
      setCreateError('Select a token');
      return;
    }
    if (!customName.trim() || !customSymbol.trim()) {
      setCreateError('Name and symbol are required');
      return;
    }
    if (marketsMap.has(selectedTokenAddr.toLowerCase())) {
      setCreateError('A market already exists for this token');
      return;
    }

    setCreating(true);
    try {
      // Try to read decimals from the token — default 18
      let dec = parseInt(secDecimals) || 18;
      try {
        const secToken = new ethers.Contract(selectedTokenAddr, SECURITY_TOKEN_ABI, provider);
        const onChainDec = await secToken.decimals();
        dec = Number(onChainDec);
      } catch {
        // fallback to input value
      }

      const tx = await contracts.orderBookFactory.createOrderBook(
        selectedTokenAddr,
        dec,
        customName.trim(),
        customSymbol.trim(),
      );
      const receipt = await tx.wait();

      // Parse the MarketCreated event for the new OrderBook address
      let obAddr = '';
      for (const log of receipt.logs) {
        try {
          const parsed = contracts.orderBookFactory.interface.parseLog({
            topics: log.topics as string[],
            data: log.data,
          });
          if (parsed?.name === 'MarketCreated') {
            obAddr = parsed.args?.orderBook ?? '';
            break;
          }
        } catch {
          /* skip */
        }
      }

      setCreateSuccess(
        `✅ Market "${customName}" created! OrderBook: ${obAddr ? obAddr.slice(0, 10) + '…' + obAddr.slice(-6) : 'deployed'}`,
      );
      setSelectedTokenAddr('');
      setCustomName('');
      setCustomSymbol('');
      loadMarkets();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setCreateError(msg.length > 200 ? msg.slice(0, 200) + '…' : msg);
    } finally {
      setCreating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Deactivate / Reactivate
  // ---------------------------------------------------------------------------

  const handleToggle = async (index: number, currentlyActive: boolean) => {
    if (!contracts?.orderBookFactory) return;
    setToggling(index);
    try {
      const tx = currentlyActive
        ? await contracts.orderBookFactory.deactivateMarket(index)
        : await contracts.orderBookFactory.reactivateMarket(index);
      await tx.wait();
      loadMarkets();
    } catch (err) {
      console.error('[MarketMgmt] toggle error:', err);
    } finally {
      setToggling(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!account) {
    return (
      <div className="text-center py-20 text-gray-400">
        <Store size={48} className="mx-auto mb-4 text-gray-600" />
        <p className="text-lg">Connect your admin wallet to manage markets</p>
      </div>
    );
  }

  // Tokens that DON'T have a market yet
  const availableTokens = tokens.filter(
    (t) => !marketsMap.has(t.tokenAddress.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Store className="text-purple-400" />
            Market Management
          </h1>
          <p className="text-gray-400 mt-1">
            Create and manage order-book markets for TokenHub-listed tokens
          </p>
        </div>
        <button
          onClick={() => {
            setMarketsLoading(true);
            setTokensLoading(true);
            loadMarkets();
            loadTokens();
          }}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors text-sm"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* Create New Market                                                 */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <PlusCircle size={20} className="text-purple-400" />
          Create New Market
        </h2>

        {tokensLoading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
            <Loader2 size={16} className="animate-spin" /> Loading listed tokens…
          </div>
        ) : availableTokens.length === 0 && tokens.length > 0 ? (
          <div className="flex items-center gap-2 text-yellow-400/80 text-sm py-4">
            <AlertTriangle size={16} />
            All listed tokens already have a market.
          </div>
        ) : tokens.length === 0 ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-4">
            <AlertTriangle size={16} />
            No tokens found in TokenFactory. Create a token first.
          </div>
        ) : (
          <form onSubmit={handleCreateMarket} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Token Picker */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Security Token</label>
                <select
                  value={selectedTokenAddr}
                  onChange={(e) => handleTokenSelect(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50 appearance-none"
                >
                  <option value="" className="bg-gray-900 text-gray-500">
                    — Select a token —
                  </option>
                  {availableTokens.map((t, i) => (
                    <option key={i} value={t.tokenAddress} className="bg-gray-900 text-white">
                      {t.symbol} — {t.name} ({t.tokenAddress.slice(0, 8)}…)
                    </option>
                  ))}
                </select>
              </div>

              {/* Decimals */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Decimals (auto-detected)</label>
                <input
                  type="number"
                  min="0"
                  max="18"
                  value={secDecimals}
                  onChange={(e) => setSecDecimals(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Market Name */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Market Name</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="e.g. HKSTP / HKD"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>

              {/* Symbol */}
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Symbol</label>
                <input
                  type="text"
                  value={customSymbol}
                  onChange={(e) => setCustomSymbol(e.target.value)}
                  placeholder="e.g. HKSTP"
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                />
              </div>
            </div>

            {createError && (
              <p className="text-red-400 text-xs flex items-center gap-1">
                <XCircle size={14} /> {createError}
              </p>
            )}
            {createSuccess && (
              <p className="text-green-400 text-xs flex items-center gap-1">
                <CheckCircle2 size={14} /> {createSuccess}
              </p>
            )}

            <button
              type="submit"
              disabled={creating || !selectedTokenAddr}
              className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Deploying OrderBook…
                </>
              ) : (
                <>
                  <PlusCircle size={16} /> Create Market
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* ────────────────────────────────────────────────────────────────── */}
      {/* All Markets Table                                                 */}
      {/* ────────────────────────────────────────────────────────────────── */}
      <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <BarChart3 size={20} className="text-purple-400" />
          All Markets ({markets.length})
        </h2>

        {marketsLoading ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm py-6 justify-center">
            <Loader2 size={16} className="animate-spin" /> Loading markets…
          </div>
        ) : markets.length === 0 ? (
          <p className="text-center text-gray-600 text-sm py-8">
            No markets created yet. Use the form above to create one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs uppercase border-b border-white/10">
                  <th className="text-left py-3 px-3">#</th>
                  <th className="text-left py-3 px-3">Market</th>
                  <th className="text-left py-3 px-3">Symbol</th>
                  <th className="text-left py-3 px-3">Security Token</th>
                  <th className="text-left py-3 px-3">OrderBook</th>
                  <th className="text-left py-3 px-3">Created</th>
                  <th className="text-center py-3 px-3">Status</th>
                  <th className="text-center py-3 px-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m, i) => (
                  <tr
                    key={i}
                    className={`border-b border-white/5 hover:bg-white/5 transition-colors ${
                      !m.active ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="py-3 px-3 text-gray-400 font-mono">{i}</td>
                    <td className="py-3 px-3 text-white font-semibold">{m.name}</td>
                    <td className="py-3 px-3 text-gray-300">{m.symbol}</td>
                    <td className="py-3 px-3 font-mono text-xs text-gray-400">
                      <span title={m.securityToken}>
                        {m.securityToken.slice(0, 8)}…{m.securityToken.slice(-6)}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-xs text-gray-400">
                      <span title={m.orderBook}>
                        {m.orderBook.slice(0, 8)}…{m.orderBook.slice(-6)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-gray-500 text-xs">
                      {m.createdAt > 0n
                        ? new Date(Number(m.createdAt) * 1000).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                          m.active
                            ? 'bg-green-500/20 text-green-400 border-green-500/30'
                            : 'bg-red-500/20 text-red-400 border-red-500/30'
                        }`}
                      >
                        {m.active ? (
                          <>
                            <Power size={10} /> Active
                          </>
                        ) : (
                          <>
                            <PowerOff size={10} /> Inactive
                          </>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => handleToggle(i, m.active)}
                        disabled={toggling === i}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                          m.active
                            ? 'bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20'
                            : 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-green-500/20'
                        } disabled:opacity-50`}
                        title={m.active ? 'Deactivate market' : 'Reactivate market'}
                      >
                        {toggling === i ? (
                          <Loader2 size={12} className="animate-spin inline" />
                        ) : m.active ? (
                          'Deactivate'
                        ) : (
                          'Reactivate'
                        )}
                      </button>
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

export default MarketManagement;
