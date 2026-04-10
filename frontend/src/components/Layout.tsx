import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ShieldCheck,
  Coins,
  ArrowRightLeft,
  Scale,
  Briefcase,
  Sparkles,
  LogOut,
  Wallet,
} from 'lucide-react';
import { useWeb3 } from '../context/Web3Context';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/kyc', label: 'KYC Management', icon: ShieldCheck },
  { to: '/mint', label: 'Token Minting', icon: Coins },
  { to: '/settlement', label: 'DvP Settlement', icon: ArrowRightLeft },
  { to: '/compliance', label: 'Compliance Rules', icon: Scale },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { account, chainId, isConnecting, connect, disconnect } = useWeb3();
  const location = useLocation();

  const shortAddr = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : '';

  return (
    <div className="min-h-screen flex">
      {/* ── Sidebar ── */}
      <aside className="w-64 bg-black/20 backdrop-blur-xl border-r border-white/10 h-screen flex flex-col fixed left-0 top-0 z-50">
        {/* Brand */}
        <div className="p-6 flex items-center gap-3 border-b border-white/10">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center text-white shadow-lg shadow-purple-900/20">
            <Sparkles size={24} fill="currentColor" className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight text-white">TokenHub</h1>
            <p className="text-xs text-purple-300 font-medium">HKSTP Investor Portal</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1.5 mt-2 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-white/10 text-white shadow-sm border border-white/5'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={20} className={isActive ? 'text-purple-400' : 'text-gray-500'} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="p-4 border-t border-white/10 space-y-2">
          {account && (
            <div className="px-4 py-2 text-xs text-gray-400 truncate">
              <span className="block text-gray-500 mb-0.5">Connected</span>
              {shortAddr} · Chain {chainId}
            </div>
          )}
          {account ? (
            <button
              onClick={disconnect}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
            >
              <LogOut size={20} />
              Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={isConnecting}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-purple-400 hover:bg-purple-500/10 rounded-xl transition-colors"
            >
              <Wallet size={20} />
              {isConnecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 ml-64 p-8">
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
};

export default Layout;
