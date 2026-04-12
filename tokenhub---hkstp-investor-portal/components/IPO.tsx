import React, { useState } from 'react';
import { Rocket, Bell, Zap, Award } from 'lucide-react';
import { MOCK_IPOS, MOCK_LISTED_IPOS } from '../constants';
import { Ipo } from '../types';

const IPO: React.FC = () => {
  const [filter, setFilter] = useState<'all' | 'live' | 'upcoming'>('all');
  const [selectedIpo, setSelectedIpo] = useState<Ipo | null>(null);

  const filteredIpos = filter === 'all' 
    ? MOCK_IPOS 
    : MOCK_IPOS.filter(ipo => ipo.status === filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center">
            <Rocket className="w-8 h-8 mr-3 text-purple-400" />
            Initial Public Offerings (IPOs)
          </h1>
          <p className="text-gray-400">Invest in early-stage startups through token offerings</p>
        </div>
        <div className="flex items-center space-x-3">
          <button className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all flex items-center">
            <Bell className="w-4 h-4 mr-2" />
            Set Alerts
          </button>
          <button className="px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-semibold hover:shadow-lg transition-all">
            My Subscriptions
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-2 w-fit mb-8">
        <button 
          onClick={() => setFilter('all')} 
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${filter === 'all' ? 'bg-purple-500/30 text-purple-300' : 'text-gray-400 hover:text-white'}`}
        >
          All IPOs
        </button>
        <button 
          onClick={() => setFilter('live')} 
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center ${filter === 'live' ? 'bg-purple-500/30 text-purple-300' : 'text-gray-400 hover:text-white'}`}
        >
          <Zap className="w-4 h-4 mr-1" />
          Live Now
          <span className="ml-2 px-2 py-0.5 bg-emerald-500 text-white text-xs rounded-full">2</span>
        </button>
        <button 
          onClick={() => setFilter('upcoming')} 
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${filter === 'upcoming' ? 'bg-purple-500/30 text-purple-300' : 'text-gray-400 hover:text-white'}`}
        >
          Upcoming
        </button>
      </div>

      {/* IPO Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {filteredIpos.map((ipo) => (
          <div 
            key={ipo.id} 
            onClick={() => setSelectedIpo(ipo)}
            className="group bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 hover:border-purple-500/50 transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-2xl flex items-center justify-center text-3xl shadow-xl text-white">
                  {ipo.logo}
                </div>
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <h3 className="text-xl font-bold text-white">{ipo.name}</h3>
                    {ipo.status === 'live' && <span className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-xs rounded-full font-semibold animate-pulse">Live</span>}
                    {ipo.status === 'upcoming' && <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full font-semibold">Upcoming</span>}
                  </div>
                  <p className="text-sm text-gray-400">{ipo.symbol} • {ipo.sector}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-white">HK$ {ipo.price}</p>
                <p className="text-xs text-gray-400">per token</p>
              </div>
            </div>

            <p className="text-gray-300 text-sm mb-4 leading-relaxed">{ipo.description}</p>

            <div className="flex flex-wrap gap-2 mb-4">
              {ipo.highlights.map((h, i) => (
                <span key={i} className="px-3 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full border border-purple-500/20">{h}</span>
              ))}
            </div>

            {ipo.status === 'live' && (
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-gray-400">Funding Progress</span>
                  <span className="text-white font-bold">{((ipo.currentRaise / ipo.targetRaise) * 100).toFixed(1)}%</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-full transition-all duration-500" 
                    style={{width: `${(ipo.currentRaise / ipo.targetRaise) * 100}%`}}
                  ></div>
                </div>
              </div>
            )}

            <button className={`w-full py-3 rounded-xl font-bold transition-all ${ipo.status === 'live' ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:shadow-lg hover:shadow-emerald-500/20 transform active:scale-[0.98]' : 'bg-white/5 text-gray-400 cursor-not-allowed border border-white/5'}`}>
              {ipo.status === 'live' ? 'Subscribe Now' : 'Coming Soon'}
            </button>
          </div>
        ))}
      </div>

      {/* Recently Listed */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6">
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
          <Award className="w-6 h-6 mr-3 text-yellow-400" />
          Recently Listed IPO Performance
        </h2>
        <div className="space-y-4">
          {MOCK_LISTED_IPOS.map((ipo) => (
            <div key={ipo.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-all cursor-pointer border border-white/5">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center text-2xl text-white">
                  {ipo.logo}
                </div>
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <p className="font-bold text-white">{ipo.name}</p>
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full border border-purple-500/20">{ipo.symbol}</span>
                  </div>
                  <p className="text-xs text-gray-400">Listed: {ipo.listingDate}</p>
                </div>
              </div>
              <div className="flex items-center space-x-8">
                <div className="text-center hidden md:block">
                  <p className="text-xs text-gray-400 mb-1">IPO Price</p>
                  <p className="text-white font-semibold">HK$ {ipo.ipoPrice.toLocaleString()}</p>
                </div>
                <div className="text-center hidden md:block">
                  <p className="text-xs text-gray-400 mb-1">Current Price</p>
                  <p className="text-white font-bold">HK$ {ipo.currentPrice.toLocaleString()}</p>
                </div>
                <div className="text-center min-w-[80px]">
                  <p className="text-xs text-gray-400 mb-1">Return</p>
                  <div className={`font-bold ${ipo.change > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {ipo.change > 0 ? '+' : ''}{ipo.change}%
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedIpo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-white/20 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl relative">
            <div className="p-8">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center space-x-4">
                  <div className="w-20 h-20 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-2xl flex items-center justify-center text-4xl shadow-xl text-white">
                    {selectedIpo.logo}
                  </div>
                  <div>
                    <h2 className="text-3xl font-bold text-white mb-2">{selectedIpo.name}</h2>
                    <div className="flex items-center space-x-3">
                      <span className="px-3 py-1 bg-purple-500/30 text-purple-300 rounded-full font-semibold border border-purple-500/30">{selectedIpo.symbol}</span>
                      <span className="px-3 py-1 bg-blue-500/30 text-blue-300 rounded-full text-sm border border-blue-500/30">{selectedIpo.sector}</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedIpo(null)} className="text-gray-400 hover:text-white text-3xl leading-none">
                  &times;
                </button>
              </div>

              <div className="bg-white/5 rounded-xl p-6 border border-white/10 mb-6">
                <h3 className="text-white font-bold text-lg mb-3">Company Overview</h3>
                <p className="text-gray-300 leading-relaxed">{selectedIpo.description}</p>
              </div>

              <div className="bg-gradient-to-r from-purple-600/20 to-pink-600/20 rounded-xl p-6 border border-purple-500/30">
                <h3 className="text-white font-bold text-xl mb-4">Subscribe to IPO</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-gray-300 text-sm mb-2">Number of Tokens</label>
                    <input
                      type="number"
                      placeholder="Minimum 1 token"
                      className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-between p-4 bg-white/10 rounded-xl border border-white/10">
                    <span className="text-gray-300">Total Amount</span>
                    <span className="text-white font-bold text-xl">HK$ 0</span>
                  </div>
                  <button className="w-full py-4 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-xl font-bold text-lg hover:shadow-xl hover:shadow-emerald-500/20 transition-all transform active:scale-[0.98]">
                    Confirm Subscription
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IPO;