import React from 'react';
import { LayoutDashboard, Store, Wallet, UserCircle, LogOut, Sparkles, Rocket } from 'lucide-react';

interface SidebarProps {
  currentView: string;
  setView: (view: string) => void;
  onLogout: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentView, setView, onLogout }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'ipo', label: 'IPOs', icon: Rocket },
    { id: 'market', label: 'Marketplace', icon: Store },
    { id: 'wallet', label: 'Wallet & Funds', icon: Wallet },
    { id: 'profile', label: 'Profile & KYC', icon: UserCircle },
  ];

  return (
    <div className="w-64 bg-black/20 backdrop-blur-xl border-r border-white/10 h-screen flex flex-col fixed left-0 top-0 z-50">
      <div className="p-6 flex items-center gap-3 border-b border-white/10">
        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-purple-900/20">
          <Sparkles size={24} fill="currentColor" className="text-white" />
        </div>
        <div>
          <h1 className="font-bold text-lg tracking-tight text-white">TokenHub Exchange</h1>
          <p className="text-xs text-purple-300 font-medium">Startup Token Trading</p>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-2 mt-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                isActive
                  ? 'bg-white/10 text-white shadow-sm border border-white/5'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon size={20} className={isActive ? 'text-purple-400' : 'text-gray-500'} />
              {item.label}
              {item.id === 'ipo' && (
                <span className="ml-auto px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs rounded-full font-semibold border border-orange-500/20">
                  2 Live
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
        >
          <LogOut size={20} />
          Sign Out
        </button>
      </div>
    </div>
  );
};

export default Sidebar;