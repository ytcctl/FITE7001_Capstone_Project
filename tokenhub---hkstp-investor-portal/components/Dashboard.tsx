import React from 'react';
import { User, PortfolioItem } from '../types';
import { MOCK_PORTFOLIO, MOCK_STARTUPS } from '../constants';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendingUp, ArrowRight, Wallet } from 'lucide-react';

interface DashboardProps {
  user: User;
  onNavigate: (view: string) => void;
}

const COLORS = ['#9333ea', '#06b6d4', '#f59e0b', '#ec4899'];

const Dashboard: React.FC<DashboardProps> = ({ user, onNavigate }) => {
  const portfolioData = MOCK_PORTFOLIO.map(item => ({
    name: item.ticker,
    value: item.amount * item.currentPrice
  }));
  
  // Add Cash
  portfolioData.push({ name: 'Cash (HKD)', value: user.cashBalance });

  return (
    <div className="space-y-6">
       <header>
        <h2 className="text-2xl font-bold text-white">Welcome back, {user.name}</h2>
        <p className="text-gray-400">Here's your investment overview.</p>
      </header>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl hover:border-purple-500/30 transition-colors">
           <p className="text-gray-400 text-sm font-medium mb-1">Total Portfolio Value</p>
           <h3 className="text-3xl font-bold text-white">HKD {(user.portfolioValue + user.cashBalance).toLocaleString()}</h3>
           <div className="mt-2 flex items-center text-emerald-400 text-sm font-medium">
             <TrendingUp size={16} className="mr-1" /> +5.2% (All time)
           </div>
        </div>
        <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl hover:border-purple-500/30 transition-colors group">
           <div className="flex justify-between items-start">
             <div>
               <p className="text-gray-400 text-sm font-medium mb-1">Available Cash</p>
               <h3 className="text-3xl font-bold text-white">HKD {user.cashBalance.toLocaleString()}</h3>
             </div>
             <div className="p-2 bg-white/5 rounded-lg text-gray-400 group-hover:text-purple-400 transition-colors">
                <Wallet size={20} />
             </div>
           </div>
           <button onClick={() => onNavigate('wallet')} className="mt-2 text-purple-400 text-sm font-medium hover:text-purple-300">Top up wallet</button>
        </div>
        <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-6 rounded-2xl shadow-xl text-white relative overflow-hidden group">
           <div className="relative z-10">
             <p className="text-purple-100 text-sm font-medium mb-1">Active Investments</p>
             <h3 className="text-3xl font-bold">{MOCK_PORTFOLIO.length} Startups</h3>
             <button onClick={() => onNavigate('market')} className="mt-2 bg-black/20 hover:bg-black/30 px-3 py-1 rounded text-sm font-medium backdrop-blur-sm transition-colors border border-white/10">
               Explore Market
             </button>
           </div>
           {/* Decorative bg */}
           <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-white/20 rounded-full blur-xl group-hover:scale-110 transition-transform duration-500"></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Allocation Chart */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 p-6 rounded-2xl h-80 flex flex-col">
          <h3 className="font-bold text-white mb-4">Asset Allocation</h3>
          <div className="flex-1">
             <ResponsiveContainer width="100%" height="100%">
               <PieChart>
                 <Pie
                   data={portfolioData}
                   cx="50%"
                   cy="50%"
                   innerRadius={60}
                   outerRadius={80}
                   paddingAngle={5}
                   dataKey="value"
                   stroke="none"
                 >
                   {portfolioData.map((entry, index) => (
                     <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                   ))}
                 </Pie>
                 <Tooltip 
                   contentStyle={{ backgroundColor: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#fff' }}
                   itemStyle={{ color: '#fff' }}
                 />
               </PieChart>
             </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-2">
            {portfolioData.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2 text-xs text-gray-400">
                <span className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS[index % COLORS.length]}}></span>
                {entry.name}
              </div>
            ))}
          </div>
        </div>

        {/* Holdings List */}
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl overflow-hidden flex flex-col">
          <div className="p-6 border-b border-white/10 flex justify-between items-center">
             <h3 className="font-bold text-white">Your Holdings</h3>
             <button onClick={() => onNavigate('market')} className="text-purple-400 text-sm font-medium flex items-center hover:text-purple-300">
               Trade <ArrowRight size={14} className="ml-1" />
             </button>
          </div>
          <div className="flex-1 overflow-auto">
             <table className="w-full">
                <thead className="bg-white/5 text-xs text-gray-400 text-left">
                  <tr>
                    <th className="px-6 py-3 font-medium">Asset</th>
                    <th className="px-6 py-3 font-medium">Shares</th>
                    <th className="px-6 py-3 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {MOCK_PORTFOLIO.map(item => {
                    const startup = MOCK_STARTUPS.find(s => s.ticker === item.ticker);
                    return (
                      <tr key={item.assetId} className="hover:bg-white/5 transition-colors">
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-3">
                             <div className="w-8 h-8 rounded bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center font-bold text-xs text-white shadow-lg shadow-blue-500/20">
                               {item.ticker.substring(0,2)}
                             </div>
                             <div>
                               <p className="font-medium text-white">{item.ticker}</p>
                               <p className="text-xs text-gray-400">{startup?.name}</p>
                             </div>
                           </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-300">{item.amount.toLocaleString()}</td>
                        <td className="px-6 py-4 text-sm font-medium text-white">HKD {(item.amount * item.currentPrice).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
             </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;