import React, { useEffect, useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../context/Web3Context';
import { ORDER_BOOK_ABI, SECURITY_TOKEN_ABI, CONTRACT_ADDRESSES } from '../config/contracts';
import {
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  RefreshCw,
  X,
  Activity,
  BarChart3,
  Clock,
  Loader2,
  ChevronDown,
  ShieldAlert,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

enum Side { Buy, Sell }
enum OrderStatus { Open, Filled, PartiallyFilled, Cancelled }

interface MarketInfo {
  securityToken: string;
  orderBook: string;
  name: string;
  symbol: string;
  createdAt: bigint;
  active: boolean;
}

interface OrderData {
  id: bigint;
  trader: string;
  side: number;
  price: bigint;
  quantity: bigint;
  filled: bigint;
  timestamp: bigint;
  status: number;
}

interface TradeData {
  id: bigint;
  buyOrderId: bigint;
  sellOrderId: bigint;
  buyer: string;
  seller: string;
  price: bigint;
  quantity: bigint;
  cashAmount: bigint;
  timestamp: bigint;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'Open',
  1: 'Filled',
  2: 'Partial',
  3: 'Cancelled',
};

const STATUS_COLORS: Record<number, string> = {
  0: 'text-blue-400',
  1: 'text-green-400',
  2: 'text-yellow-400',
  3: 'text-gray-500',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format security token amount (18 decimals) */
function fmtSec(val: bigint): string {
  return Number(ethers.formatUnits(val, 18)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

/** Format cash amount (6 decimals) */
function fmtCash(val: bigint): string {
  return Number(ethers.formatUnits(val, 6)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/** Format price: cash per 1 whole security token */
function fmtPrice(price: bigint): string {
  return Number(ethers.formatUnits(price, 6)).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

/** Convert an ethers Result (Proxy/tuple) to a plain OrderData object. */
function toPlainOrder(o: OrderData): OrderData {
  return { id: o.id, trader: o.trader, side: o.side, price: o.price, quantity: o.quantity, filled: o.filled, timestamp: o.timestamp, status: o.status };
}

function timeAgo(ts: bigint): string {
  const diff = Math.floor(Date.now() / 1000) - Number(ts);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Trading: React.FC = () => {
  const { contracts, account, signer } = useWeb3();

  // Market selection
  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<MarketInfo | null>(null);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Dynamic OrderBook + SecurityToken contracts for the selected market
  const [obContract, setObContract] = useState<ethers.Contract | null>(null);
  const [secTokenContract, setSecTokenContract] = useState<ethers.Contract | null>(null);

  // Order form
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Order book data
  const [buyOrders, setBuyOrders] = useState<OrderData[]>([]);
  const [sellOrders, setSellOrders] = useState<OrderData[]>([]);
  const [myOrders, setMyOrders] = useState<OrderData[]>([]);
  const [recentTrades, setRecentTrades] = useState<TradeData[]>([]);

  // Market stats
  const [bestBidPrice, setBestBidPrice] = useState<bigint>(0n);
  const [bestAskPrice, setBestAskPrice] = useState<bigint>(0n);
  const [spreadVal, setSpreadVal] = useState<bigint>(0n);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalTrades, setTotalTrades] = useState(0);

  // Price stats
  const [lastTradePrice, setLastTradePrice] = useState<bigint>(0n);
  const [dailyChange, setDailyChange] = useState<number | null>(null); // % change

  // Token balances
  const [secBalance, setSecBalance] = useState<bigint>(0n);
  const [cashBalance, setCashBalance] = useState<bigint>(0n);

  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState<bigint | null>(null);

  // KYC status
  const [kycVerified, setKycVerified] = useState<boolean | null>(null); // null = checking
  const [kycChecking, setKycChecking] = useState(true);

  // ---------------------------------------------------------------------------
  // Fetch available markets from OrderBookFactory
  // ---------------------------------------------------------------------------

  const fetchMarkets = useCallback(async () => {
    if (!contracts?.orderBookFactory) {
      setMarketsLoading(false);
      return;
    }
    try {
      const activeList = await contracts.orderBookFactory.activeMarkets() as MarketInfo[];
      setMarkets(activeList);
      // Auto-select first market if nothing selected
      if (activeList.length > 0 && !selectedMarket) {
        setSelectedMarket(activeList[0]);
      }
    } catch (err) {
      console.error('[Trading] fetchMarkets error:', err);
    } finally {
      setMarketsLoading(false);
    }
  }, [contracts, selectedMarket]);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  // ---------------------------------------------------------------------------
  // Check KYC verification status
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const checkKyc = async () => {
      if (!contracts?.identityRegistry || !account) {
        setKycVerified(null);
        setKycChecking(false);
        return;
      }
      setKycChecking(true);
      try {
        const verified: boolean = await contracts.identityRegistry.isVerified(account);
        if (!cancelled) {
          setKycVerified(verified);
        }
      } catch (err) {
        console.error('[Trading] KYC check failed:', err);
        if (!cancelled) setKycVerified(null);
      } finally {
        if (!cancelled) setKycChecking(false);
      }
    };
    checkKyc();
    return () => { cancelled = true; };
  }, [contracts, account]);

  // ---------------------------------------------------------------------------
  // When market changes, create dynamic contract instances
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!selectedMarket || !signer) {
      setObContract(null);
      setSecTokenContract(null);
      return;
    }
    const ob = new ethers.Contract(selectedMarket.orderBook, ORDER_BOOK_ABI, signer);
    const sec = new ethers.Contract(selectedMarket.securityToken, SECURITY_TOKEN_ABI, signer);
    setObContract(ob);
    setSecTokenContract(sec);
    // Reset data when switching markets
    setBuyOrders([]);
    setSellOrders([]);
    setMyOrders([]);
    setRecentTrades([]);
    setBestBidPrice(0n);
    setBestAskPrice(0n);
    setSpreadVal(0n);
    setTotalOrders(0);
    setTotalTrades(0);
    setLastTradePrice(0n);
    setDailyChange(null);
    setSecBalance(0n);
    setLoading(true);
  }, [selectedMarket, signer]);

  // ---------------------------------------------------------------------------
  // Data fetching for selected market
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    if (!obContract || !secTokenContract || !account || !contracts) return;

    try {
      const [buyIds, sellIds, traderIds, bBid, bAsk, sp, oc, tc] = await Promise.all([
        obContract.getBuyOrderIds() as Promise<bigint[]>,
        obContract.getSellOrderIds() as Promise<bigint[]>,
        obContract.getTraderOrders(account) as Promise<bigint[]>,
        obContract.bestBid() as Promise<bigint>,
        obContract.bestAsk() as Promise<bigint>,
        obContract.spread() as Promise<bigint>,
        obContract.orderCount() as Promise<bigint>,
        obContract.tradeCount() as Promise<bigint>,
      ]);

      setBestBidPrice(bBid);
      setBestAskPrice(bAsk);
      setSpreadVal(sp);
      setTotalOrders(Number(oc));
      setTotalTrades(Number(tc));

      if (buyIds.length > 0) {
        const raw = await obContract.getOrdersBatch([...buyIds]) as OrderData[];
        setBuyOrders(raw.map(toPlainOrder));
      } else {
        setBuyOrders([]);
      }

      if (sellIds.length > 0) {
        const raw = await obContract.getOrdersBatch([...sellIds]) as OrderData[];
        setSellOrders(raw.map(toPlainOrder));
      } else {
        setSellOrders([]);
      }

      if (traderIds.length > 0) {
        const raw = await obContract.getOrdersBatch([...traderIds]) as OrderData[];
        const activeOrders = raw.map(toPlainOrder);
        // Merge: keep locally-cancelled orders so the user sees the status change
        setMyOrders(prev => {
          const cancelled = prev.filter(o => Number(o.status) === OrderStatus.Cancelled);
          const activeIds = new Set(activeOrders.map(o => o.id.toString()));
          const kept = cancelled.filter(o => !activeIds.has(o.id.toString()));
          return [...activeOrders, ...kept];
        });
      } else {
        // Preserve any locally-cancelled orders
        setMyOrders(prev => prev.filter(o => Number(o.status) === OrderStatus.Cancelled));
      }

      const tradeTotal = Number(tc);
      if (tradeTotal > 0) {
        // Fetch last 20 trades for the Recent Trades panel
        const from = Math.max(0, tradeTotal - 20);
        const batch = await obContract.getTradesBatch(from, tradeTotal) as TradeData[];
        const sortedDesc = batch.slice().reverse();
        setRecentTrades(sortedDesc);

        // ── Last Traded Price ──
        const latestTrade = sortedDesc[0];
        setLastTradePrice(latestTrade.price);

        // ── Daily % Change ──
        // Walk backwards through ALL trades to find the earliest trade within 24 h
        const now = Math.floor(Date.now() / 1000);
        const oneDayAgo = now - 86_400;

        // We already have the last 20; fetch more if the oldest one is still < 24 h old
        let allRecent = batch.slice(); // ascending order (oldest→newest)
        if (allRecent.length > 0 && Number(allRecent[0].timestamp) > oneDayAgo && from > 0) {
          // Need older trades — fetch the rest (up to 200 max for gas/perf)
          const olderFrom = Math.max(0, from - 200);
          const olderBatch = await obContract.getTradesBatch(olderFrom, from) as TradeData[];
          allRecent = [...olderBatch, ...allRecent];
        }

        // Find the last trade that occurred AT or BEFORE the 24-hour boundary.
        // If no such trade exists it means ALL trades happened within the last
        // 24 h and we lack a true 24-hour reference point → show "—" instead
        // of a misleading partial-window percentage.
        let refPrice: bigint | null = null;
        for (const t of allRecent) {
          if (Number(t.timestamp) <= oneDayAgo) {
            refPrice = t.price; // keeps overwriting → last trade at or before boundary
          }
        }

        if (refPrice !== null && refPrice > 0n) {
          // True 24 h change: compare latest price vs the reference price
          const latest = Number(latestTrade.price);
          const ref = Number(refPrice);
          setDailyChange(((latest - ref) / ref) * 100);
        } else {
          // Not enough history to compute a full 24 h change
          setDailyChange(null);
        }
      } else {
        setRecentTrades([]);
        setLastTradePrice(0n);
        setDailyChange(null);
      }

      // Balances
      const [secBal, cashBal] = await Promise.all([
        secTokenContract.balanceOf(account) as Promise<bigint>,
        contracts.cashToken.balanceOf(account) as Promise<bigint>,
      ]);
      setSecBalance(secBal);
      setCashBalance(cashBal);
    } catch (err) {
      console.error('[Trading] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  }, [obContract, secTokenContract, account, contracts]);

  // Initial load + auto-refresh every 5s
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Place order
  // ---------------------------------------------------------------------------

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!obContract || !secTokenContract || !contracts || !account || !selectedMarket) {
      setFormError('Select a market and connect wallet first');
      return;
    }

    if (!kycVerified) {
      setFormError('Your wallet has not passed KYC verification. Please complete identity verification before trading.');
      return;
    }

    const priceNum = parseFloat(price);
    const qtyNum = parseFloat(quantity);
    if (isNaN(priceNum) || priceNum <= 0) {
      setFormError('Enter a valid price');
      return;
    }
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setFormError('Enter a valid quantity');
      return;
    }

    setSubmitting(true);

    try {
      const obAddr = await obContract.getAddress();
      const priceBN = ethers.parseUnits(price, 6);
      const qtyBN = ethers.parseUnits(quantity, 18);

      if (side === 'buy') {
        const cashNeeded = (priceBN * qtyBN) / ethers.parseUnits('1', 18);
        const currentAllowance = await contracts.cashToken.allowance(account, obAddr);
        if (currentAllowance < cashNeeded) {
          const approveTx = await contracts.cashToken.approve(obAddr, cashNeeded);
          await approveTx.wait();
        }
        const tx = await obContract.placeBuyOrder(priceBN, qtyBN);
        await tx.wait();
        setFormSuccess(`Buy order placed for ${selectedMarket.symbol}! Tx: ${tx.hash.slice(0, 10)}…`);
      } else {
        const currentAllowance = await secTokenContract.allowance(account, obAddr);
        if (currentAllowance < qtyBN) {
          const approveTx = await secTokenContract.approve(obAddr, qtyBN);
          await approveTx.wait();
        }
        const tx = await obContract.placeSellOrder(priceBN, qtyBN);
        await tx.wait();
        setFormSuccess(`Sell order placed for ${selectedMarket.symbol}! Tx: ${tx.hash.slice(0, 10)}…`);
      }

      setPrice('');
      setQuantity('');
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed';
      setFormError(msg.length > 120 ? msg.slice(0, 120) + '…' : msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Cancel order
  // ---------------------------------------------------------------------------

  const handleCancel = async (orderId: bigint) => {
    if (!obContract) return;
    setCancelling(orderId);
    try {
      const tx = await obContract.cancelOrder(orderId);
      await tx.wait();

      // Update local state to show Cancelled status instead of removing the order.
      // The contract removes cancelled orders from getTraderOrders(), so a plain
      // refetch would make the row disappear.  We mark it cancelled locally first,
      // then refetch the rest of the book data in the background.
      setMyOrders(prev =>
        prev.map(o =>
          o.id === orderId
            ? { ...toPlainOrder(o), status: OrderStatus.Cancelled as unknown as bigint }
            : o,
        ),
      );
      fetchData();
    } catch (err) {
      console.error('Cancel failed:', err);
    } finally {
      setCancelling(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!account) {
    return (
      <div className="text-center py-20 text-gray-400">
        <ArrowUpDown size={48} className="mx-auto mb-4 text-gray-600" />
        <p className="text-lg">Connect your wallet to start trading</p>
      </div>
    );
  }

  if (marketsLoading) {
    return (
      <div className="text-center py-20 text-gray-400">
        <Loader2 size={32} className="animate-spin mx-auto mb-4" />
        <p>Loading markets…</p>
      </div>
    );
  }

  const tokenSymbol = selectedMarket?.symbol ?? 'TOKEN';

  return (
    <div className="space-y-6">
      {/* Header + Market Selector */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <BarChart3 className="text-purple-400" />
            Trading
          </h1>
          <p className="text-gray-400 mt-1">TokenHub Order Book — Trade any listed token</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Market Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/15 rounded-xl text-white text-sm font-medium border border-white/10 min-w-[200px] justify-between transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400"></span>
                {selectedMarket ? selectedMarket.name : 'Select Market'}
              </span>
              <ChevronDown size={16} className={`text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-gray-900 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
                {markets.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">No markets available</div>
                ) : (
                  markets.map((m, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setSelectedMarket(m);
                        setDropdownOpen(false);
                        setFormError('');
                        setFormSuccess('');
                      }}
                      className={`w-full text-left px-4 py-3 text-sm hover:bg-white/10 transition-colors border-b border-white/5 last:border-0 ${
                        selectedMarket?.securityToken === m.securityToken
                          ? 'bg-purple-500/10 text-purple-300'
                          : 'text-gray-300'
                      }`}
                    >
                      <div className="font-semibold">{m.name}</div>
                      <div className="text-xs text-gray-500 mt-0.5 font-mono">
                        {m.securityToken.slice(0, 10)}…{m.securityToken.slice(-6)}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors text-sm"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* No market selected */}
      {!selectedMarket && markets.length === 0 && (
        <div className="bg-white/5 rounded-2xl border border-white/10 p-12 text-center">
          <BarChart3 size={48} className="mx-auto mb-4 text-gray-600" />
          <p className="text-gray-400 text-lg mb-2">No markets available</p>
          <p className="text-gray-500 text-sm">Ask a platform admin to create an order book for a listed token.</p>
        </div>
      )}

      {selectedMarket && (
        <>
          {/* KYC Warning Banner */}
          {!kycChecking && kycVerified === false && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 flex items-start gap-3">
              <ShieldAlert size={24} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 font-semibold">KYC Verification Required</p>
                <p className="text-red-300/70 text-sm mt-1">
                  Your wallet address has not passed KYC (Know Your Customer) verification.
                  You must complete identity verification before you can place buy or sell orders.
                  Please contact the platform administrator or visit the Identity Management page.
                </p>
              </div>
            </div>
          )}
          {/* Loading indicator */}
          {loading && (
            <div className="text-center py-6 text-gray-400">
              <Loader2 size={24} className="animate-spin mx-auto mb-2" />
              <p className="text-sm">Loading order book for {tokenSymbol}…</p>
            </div>
          )}

          {/* Market Overview Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <StatCard label="Last Price" value={lastTradePrice > 0n ? `$${fmtPrice(lastTradePrice)}` : '—'} color="text-white" />
            <DailyChangeCard change={dailyChange} />
            <StatCard label="Best Bid" value={bestBidPrice > 0n ? `$${fmtPrice(bestBidPrice)}` : '—'} color="text-green-400" />
            <StatCard label="Best Ask" value={bestAskPrice > 0n ? `$${fmtPrice(bestAskPrice)}` : '—'} color="text-red-400" />
            <StatCard label="Spread" value={spreadVal > 0n ? `$${fmtPrice(spreadVal)}` : '—'} color="text-yellow-400" />
            <StatCard label="Total Orders" value={totalOrders.toString()} color="text-blue-400" />
            <StatCard label="Total Trades" value={totalTrades.toString()} color="text-purple-400" />
          </div>

          {/* Balances */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-xs text-gray-500 mb-1">{tokenSymbol} Balance</p>
              <p className="text-lg font-bold text-white">{fmtSec(secBalance)} <span className="text-xs text-gray-400">{tokenSymbol}</span></p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <p className="text-xs text-gray-500 mb-1">Cash Balance</p>
              <p className="text-lg font-bold text-white">${fmtCash(cashBalance)} <span className="text-xs text-gray-400">HKD</span></p>
            </div>
          </div>

          {/* Main grid: Order Form + Order Book + Recent Trades */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* ── Order Form ── */}
            <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Activity size={20} className="text-purple-400" />
                Place Order — {tokenSymbol}
              </h2>

              {/* Buy / Sell Toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setSide('buy')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    side === 'buy'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  <TrendingUp size={16} className="inline mr-1.5" />
                  Buy
                </button>
                <button
                  onClick={() => setSide('sell')}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                    side === 'sell'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  <TrendingDown size={16} className="inline mr-1.5" />
                  Sell
                </button>
              </div>

              <form onSubmit={handlePlaceOrder} className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Price (HKD per {tokenSymbol})</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1.5">Quantity ({tokenSymbol})</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  />
                </div>

                {/* Estimated total */}
                {price && quantity && (
                  <div className="bg-white/5 rounded-xl p-3 text-sm">
                    <span className="text-gray-400">Estimated Total: </span>
                    <span className="text-white font-semibold">
                      ${(parseFloat(price) * parseFloat(quantity)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} HKD
                    </span>
                  </div>
                )}

                {formError && <p className="text-red-400 text-xs">{formError}</p>}
                {formSuccess && <p className="text-green-400 text-xs">{formSuccess}</p>}

                <button
                  type="submit"
                  disabled={submitting || kycVerified === false}
                  className={`w-full py-3 rounded-xl text-sm font-bold transition-all ${
                    kycVerified === false
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : side === 'buy'
                        ? 'bg-green-600 hover:bg-green-500 text-white'
                        : 'bg-red-600 hover:bg-red-500 text-white'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {kycVerified === false ? (
                    <><ShieldAlert size={16} className="inline mr-2" />KYC Required</>
                  ) : submitting ? (
                    <><Loader2 size={16} className="inline animate-spin mr-2" />Submitting…</>
                  ) : (
                    `Place ${side === 'buy' ? 'Buy' : 'Sell'} Order`
                  )}
                </button>
              </form>
            </div>

            {/* ── Order Book ── */}
            <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <ArrowUpDown size={20} className="text-purple-400" />
                Order Book — {tokenSymbol}
              </h2>

              {/* Asks (sell orders) — displayed in reverse so lowest ask at bottom */}
              <div className="mb-2">
                <div className="grid grid-cols-3 text-xs text-gray-500 mb-1 px-2">
                  <span>Price (HKD)</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Total</span>
                </div>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {sellOrders.length === 0 ? (
                    <p className="text-center text-gray-600 text-xs py-3">No sell orders</p>
                  ) : (
                    [...sellOrders].reverse().map((o, i) => {
                      const remaining = o.quantity - o.filled;
                      const total = (o.price * remaining) / ethers.parseUnits('1', 18);
                      return (
                        <div key={i} className="grid grid-cols-3 text-xs px-2 py-1 rounded hover:bg-red-500/5">
                          <span className="text-red-400 font-mono">{fmtPrice(o.price)}</span>
                          <span className="text-right text-gray-300 font-mono">{fmtSec(remaining)}</span>
                          <span className="text-right text-gray-500 font-mono">{fmtCash(total)}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Spread indicator */}
              <div className="border-y border-white/10 py-2 my-2 text-center">
                <span className="text-xs text-gray-500">Spread: </span>
                <span className="text-xs text-yellow-400 font-mono">
                  {spreadVal > 0n ? `$${fmtPrice(spreadVal)}` : '—'}
                </span>
              </div>

              {/* Bids (buy orders) */}
              <div>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {buyOrders.length === 0 ? (
                    <p className="text-center text-gray-600 text-xs py-3">No buy orders</p>
                  ) : (
                    buyOrders.map((o, i) => {
                      const remaining = o.quantity - o.filled;
                      const total = (o.price * remaining) / ethers.parseUnits('1', 18);
                      return (
                        <div key={i} className="grid grid-cols-3 text-xs px-2 py-1 rounded hover:bg-green-500/5">
                          <span className="text-green-400 font-mono">{fmtPrice(o.price)}</span>
                          <span className="text-right text-gray-300 font-mono">{fmtSec(remaining)}</span>
                          <span className="text-right text-gray-500 font-mono">{fmtCash(total)}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* ── Recent Trades ── */}
            <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Clock size={20} className="text-purple-400" />
                Recent Trades
              </h2>

              <div className="space-y-0.5 max-h-80 overflow-y-auto">
                {recentTrades.length === 0 ? (
                  <p className="text-center text-gray-600 text-xs py-6">No trades yet</p>
                ) : (
                  <>
                    <div className="grid grid-cols-4 text-xs text-gray-500 mb-1 px-2">
                      <span>Price</span>
                      <span className="text-right">Qty</span>
                      <span className="text-right">Total</span>
                      <span className="text-right">Time</span>
                    </div>
                    {recentTrades.map((t, i) => (
                      <div key={i} className="grid grid-cols-4 text-xs px-2 py-1 rounded hover:bg-white/5">
                        <span className="text-white font-mono">{fmtPrice(t.price)}</span>
                        <span className="text-right text-gray-300 font-mono">{fmtSec(t.quantity)}</span>
                        <span className="text-right text-gray-400 font-mono">{fmtCash(t.cashAmount)}</span>
                        <span className="text-right text-gray-500">{timeAgo(t.timestamp)}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── My Orders ── */}
          <div className="bg-white/5 rounded-2xl border border-white/10 p-6">
            <h2 className="text-lg font-semibold text-white mb-4">My Active Orders — {tokenSymbol}</h2>

            {myOrders.length === 0 ? (
              <p className="text-center text-gray-600 text-sm py-6">No active orders</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs border-b border-white/10">
                      <th className="text-left py-2 px-3">ID</th>
                      <th className="text-left py-2 px-3">Side</th>
                      <th className="text-right py-2 px-3">Price (HKD)</th>
                      <th className="text-right py-2 px-3">Quantity</th>
                      <th className="text-right py-2 px-3">Filled</th>
                      <th className="text-center py-2 px-3">Status</th>
                      <th className="text-right py-2 px-3">Time</th>
                      <th className="text-center py-2 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myOrders.map((o, i) => (
                      <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-2 px-3 text-gray-300 font-mono">#{Number(o.id)}</td>
                        <td className="py-2 px-3">
                          <span className={`font-semibold ${Number(o.side) === Side.Buy ? 'text-green-400' : 'text-red-400'}`}>
                            {Number(o.side) === Side.Buy ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-white font-mono">{fmtPrice(o.price)}</td>
                        <td className="py-2 px-3 text-right text-gray-300 font-mono">{fmtSec(o.quantity)}</td>
                        <td className="py-2 px-3 text-right text-gray-400 font-mono">{fmtSec(o.filled)}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`text-xs font-semibold ${STATUS_COLORS[Number(o.status)]}`}>
                            {STATUS_LABELS[Number(o.status)]}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-500 text-xs">{timeAgo(o.timestamp)}</td>
                        <td className="py-2 px-3 text-center">
                          {(Number(o.status) === OrderStatus.Open || Number(o.status) === OrderStatus.PartiallyFilled) && (
                            <button
                              onClick={() => handleCancel(o.id)}
                              disabled={cancelling === o.id}
                              className="text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                              title="Cancel order"
                            >
                              {cancelling === o.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <X size={14} />
                              )}
                            </button>
                          )}
                        </td>
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="bg-white/5 rounded-xl p-4 border border-white/10">
    <p className="text-xs text-gray-500 mb-1">{label}</p>
    <p className={`text-lg font-bold ${color}`}>{value}</p>
  </div>
);

/** Dedicated card for Daily % Change with up/down arrow & colour coding */
const DailyChangeCard: React.FC<{ change: number | null }> = ({ change }) => {
  let display: string;
  let color: string;
  let Icon: typeof TrendingUp | null = null;

  if (change === null || change === undefined) {
    display = '—';
    color = 'text-gray-400';
  } else if (change > 0) {
    display = `+${change.toFixed(2)}%`;
    color = 'text-green-400';
    Icon = TrendingUp;
  } else if (change < 0) {
    display = `${change.toFixed(2)}%`;
    color = 'text-red-400';
    Icon = TrendingDown;
  } else {
    display = '0.00%';
    color = 'text-gray-400';
  }

  return (
    <div className="bg-white/5 rounded-xl p-4 border border-white/10">
      <p className="text-xs text-gray-500 mb-1">24h Change</p>
      <p className={`text-lg font-bold ${color} flex items-center gap-1`}>
        {Icon && <Icon size={18} />}
        {display}
      </p>
    </div>
  );
};

export default Trading;
