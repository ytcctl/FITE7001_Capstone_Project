import React, { useState } from 'react';
import { ArrowLeft, TrendingUp, TrendingDown, Lock, Check } from 'lucide-react';
import { Startup, Order, User } from '../types';
import { MOCK_ORDERS } from '../constants';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface TradingProps {
  asset: Startup;
  onBack: () => void;
  user: User;
}

const Trading: React.FC<TradingProps> = ({ asset, onBack, user }) => {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [amount, setAmount] = useState<string>('');
  const [price, setPrice] = useState<string>(asset.sharePrice.toString());
  const [isProcessing, setIsProcessing] = useState(false);
  const [txSuccess, setTxSuccess] = useState(false);

  const handleTrade = () => {
    setIsProcessing(true);
    // Simulate Blockchain Atomic DvP
    setTimeout(() => {
      setIsProcessing(false);
      setTxSuccess(true);
      setTimeout(() => setTxSuccess(false), 3000);
    }, 2000);
  };

  const total = Number(amount) * Number(price);
  
  // Mock data for chart
  const chartData = [
    { name: '10:00', price: asset.sharePrice - 0.5 },
    { name: '11:00', price: asset.sharePrice - 0.2 },
    { name: '12:00', price: asset.sharePrice + 0.1 },
    { name: '13:00', price: asset.sharePrice - 0.1 },
    { name: '14:00', price: asset.sharePrice + 0.4 },
    { name: '15:00', price: asset.sharePrice },
  ];

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors">
        <ArrowLeft size={18} /> Back to Market
      </button>

      {/* Asset Header */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <img src={asset.logoUrl} alt={asset.name} className="w-16 h-16 rounded-xl bg-white/10 object-cover ring-1 ring-white/10" />
          <div>
            <h1 className="text-2xl font-bold text-white">{asset.name} <span className="text-gray-500 text-lg font-normal">/ {asset.ticker}</span></h1>
            <span className="bg-purple-500/20 border border-purple-500/30 text-purple-300 px-2 py-0.5 rounded text-xs font-semibold">{asset.industry}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold text-white">HKD {asset.sharePrice.toFixed(2)}</p>
          <p className={`flex items-center justify-end gap-1 font-medium ${asset.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {asset.change24h >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            {asset.change24h}% (24h)
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart & Order Book */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl h-80">
            <h3 className="font-bold text-white mb-4">Price History</h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                 <XAxis dataKey="name" fontSize={12} stroke="#94a3b8" />
                 <YAxis fontSize={12} stroke="#94a3b8" domain={['auto', 'auto']} />
                 <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                    itemStyle={{ color: '#fff' }}
                    cursor={{fill: 'rgba(255,255,255,0.05)'}} 
                 />
                 <Bar dataKey="price" fill="#a855f7" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden">
             <div className="p-4 border-b border-white/10 bg-white/5 flex justify-between">
                <h3 className="font-bold text-white">Order Book</h3>
                <span className="text-xs text-emerald-400 flex items-center gap-1">
                   <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Live
                </span>
             </div>
             <table className="w-full">
                <thead className="text-xs text-gray-400 bg-white/5">
                   <tr>
                      <th className="px-4 py-2 text-left">Price (HKD)</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-right">Total</th>
                   </tr>
                </thead>
                <tbody className="text-sm">
                   {/* Asks */}
                   {MOCK_ORDERS.filter(o => o.type === 'SELL').slice(0, 3).reverse().map(o => (
                      <tr key={o.id} className="hover:bg-rose-500/10">
                         <td className="px-4 py-2 text-rose-400 font-medium">{o.price.toFixed(2)}</td>
                         <td className="px-4 py-2 text-right text-gray-300">{o.amount}</td>
                         <td className="px-4 py-2 text-right text-gray-500">{(o.price * o.amount).toFixed(0)}</td>
                      </tr>
                   ))}
                   <tr className="bg-white/5 border-y border-white/10">
                      <td colSpan={3} className="px-4 py-1 text-center font-bold text-white">{asset.sharePrice.toFixed(2)} <span className="text-xs font-normal text-gray-500">Last Trade</span></td>
                   </tr>
                   {/* Bids */}
                   {MOCK_ORDERS.filter(o => o.type === 'BUY').slice(0, 3).map(o => (
                      <tr key={o.id} className="hover:bg-emerald-500/10">
                         <td className="px-4 py-2 text-emerald-400 font-medium">{o.price.toFixed(2)}</td>
                         <td className="px-4 py-2 text-right text-gray-300">{o.amount}</td>
                         <td className="px-4 py-2 text-right text-gray-500">{(o.price * o.amount).toFixed(0)}</td>
                      </tr>
                   ))}
                </tbody>
             </table>
          </div>
        </div>

        {/* Trade Execution */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 flex flex-col">
           <div className="flex bg-white/5 p-1 rounded-xl mb-6">
              <button 
                onClick={() => setSide('BUY')}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${side === 'BUY' ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow' : 'text-gray-400 hover:text-white'}`}
              >
                Buy
              </button>
              <button 
                onClick={() => setSide('SELL')}
                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${side === 'SELL' ? 'bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
              >
                Sell
              </button>
           </div>

           <div className="space-y-4 flex-1">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Limit Price</label>
                <div className="relative mt-1">
                   <input 
                      type="number" 
                      value={price} 
                      onChange={e => setPrice(e.target.value)}
                      className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-purple-500 outline-none font-mono placeholder-gray-600" 
                   />
                   <span className="absolute right-3 top-3 text-gray-500 text-sm">HKD</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Amount</label>
                <div className="relative mt-1">
                   <input 
                      type="number" 
                      value={amount} 
                      onChange={e => setAmount(e.target.value)}
                      className="w-full p-3 rounded-xl bg-white/5 border border-white/10 text-white focus:ring-2 focus:ring-purple-500 outline-none font-mono placeholder-gray-600" 
                   />
                   <span className="absolute right-3 top-3 text-gray-500 text-sm">Shares</span>
                </div>
              </div>

              <div className="py-4 border-t border-b border-white/10 my-4 space-y-2">
                 <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Available Balance</span>
                    <span className="font-medium text-gray-300">{side === 'BUY' ? `HKD ${user.cashBalance.toLocaleString()}` : `0 ${asset.ticker}`}</span>
                 </div>
                 <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Fees (0.1%)</span>
                    <span className="font-medium text-gray-300">HKD {(total * 0.001).toFixed(2)}</span>
                 </div>
                 <div className="flex justify-between text-lg font-bold pt-2 text-white">
                    <span>Total</span>
                    <span>HKD {total.toLocaleString()}</span>
                 </div>
              </div>

              {txSuccess ? (
                <div className="bg-emerald-500/20 border border-emerald-500/30 p-4 rounded-xl flex items-center justify-center gap-2 text-emerald-400 font-bold animate-in fade-in zoom-in">
                  <Check size={20} /> Trade Settled (DvP)
                </div>
              ) : (
                <button 
                  onClick={handleTrade}
                  disabled={isProcessing || !amount || total === 0}
                  className={`w-full py-3.5 rounded-xl font-bold text-white shadow-lg transition-transform active:scale-[0.98] flex items-center justify-center gap-2
                    ${side === 'BUY' ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:shadow-emerald-500/30' : 'bg-gradient-to-r from-rose-600 to-pink-600 hover:shadow-rose-500/30'}
                    ${isProcessing ? 'opacity-75 cursor-wait' : ''}
                  `}
                >
                  {isProcessing ? (
                     <>
                        <Lock size={18} className="animate-pulse" />
                        Settling On-Chain...
                     </>
                  ) : (
                     `${side} ${asset.ticker}`
                  )}
                </button>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default Trading;