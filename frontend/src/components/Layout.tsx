import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  ShieldCheck,
  Coins,
  ArrowRightLeft,
  Scale,
  Briefcase,
  Building2,
  Sparkles,
  LogOut,
  Wallet,
  Lock,
  Vote,
} from 'lucide-react';
import { useWeb3 } from '../context/Web3Context';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/kyc', label: 'KYC Management', icon: ShieldCheck, adminOnly: true },
  { to: '/mint', label: 'Token Minting', icon: Coins, adminOnly: true },
  { to: '/settlement', label: 'DvP Settlement', icon: ArrowRightLeft },
  { to: '/compliance', label: 'Compliance Rules', icon: Scale, adminOnly: true },
  { to: '/tokens', label: 'Token Management', icon: Building2, adminOnly: true },
  { to: '/governance', label: 'Governance', icon: Vote },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { account, chainId, roles, rolesLoading, isConnecting, connect, disconnect } = useWeb3();
  const location = useLocation();

  const isAdminOrAgent = roles.isAdmin || roles.isAgent;
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
            const isHidden = item.adminOnly && !isAdminOrAgent && !rolesLoading;

            if (isHidden) return null;

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
                {item.adminOnly && (
                  <Lock size={12} className="ml-auto text-yellow-500/60" />
                )}
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
              <span className={`ml-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                isAdminOrAgent
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                {rolesLoading ? '…' : isAdminOrAgent ? 'ADMIN' : 'INVESTOR'}
              </span>
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
