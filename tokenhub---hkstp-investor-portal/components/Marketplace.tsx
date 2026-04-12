import React from 'react';
import { MOCK_STARTUPS } from '../constants';
import { Search, Filter, ArrowUpRight } from 'lucide-react';
import { Startup } from '../types';

interface MarketplaceProps {
  onSelectAsset: (asset: Startup) => void;
}

const Marketplace: React.FC<MarketplaceProps> = ({ onSelectAsset }) => {
  return (
    <div className="space-y-6">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Startup Marketplace</h2>
          <p className="text-gray-400">Discover and invest in HKSTP-vetted technology companies.</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            <input 
              type="text" 
              placeholder="Search companies..." 
              className="pl-10 pr-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl outline-none focus:ring-2 focus:ring-purple-500 w-full md:w-64 placeholder-gray-500 hover:bg-white/10 transition-colors"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-gray-300 hover:bg-white/10 hover:text-white transition-colors">
            <Filter size={18} /> Filter
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {MOCK_STARTUPS.map((startup) => (
          <div key={startup.id} className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl hover:border-purple-500/50 transition-all duration-300 overflow-hidden group hover:bg-white/10">
            <div className="p-6">
               <div className="flex justify-between items-start mb-4">
                 <div className="flex gap-4">
                    <img src={startup.logoUrl} alt={startup.name} className="w-14 h-14 rounded-xl object-cover bg-white/10 ring-1 ring-white/10" />
                    <div>
                      <h3 className="font-bold text-lg text-white group-hover:text-purple-400 transition-colors">{startup.name}</h3>
                      <span className="text-xs font-semibold px-2 py-0.5 bg-purple-500/20 text-purple-300 rounded-full border border-purple-500/20">{startup.industry}</span>
                    </div>
                 </div>
                 <div className="text-right">
                   <p className="font-bold text-white">HKD {startup.sharePrice.toFixed(2)}</p>
                   <p className={`text-xs font-medium ${startup.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                     {startup.change24h >= 0 ? '+' : ''}{startup.change24h}%
                   </p>
                 </div>
               </div>
               
               <p className="text-sm text-gray-400 line-clamp-2 mb-6 h-10 leading-relaxed">
                 {startup.description}
               </p>

               <div className="space-y-2 mb-6">
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-500">Valuation</span>
                   <span className="font-medium text-gray-300">HKD {(startup.valuation / 1000000).toFixed(1)}M</span>
                 </div>
                 <div className="flex justify-between text-sm">
                   <span className="text-gray-500">Ticker</span>
                   <span className="font-mono bg-white/5 border border-white/10 px-2 rounded text-gray-300">{startup.ticker}</span>
                 </div>
               </div>

               <button 
                 onClick={() => onSelectAsset(startup)}
                 className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-blue-500/20 transition-all transform active:scale-[0.98] flex items-center justify-center gap-2"
               >
                 Trade Token <ArrowUpRight size={16} />
               </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Marketplace;