import React, { useState } from 'react';
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
  Vault,
  BarChart3,
  Store,
  Key,
  ChevronDown,
} from 'lucide-react';
import { useWeb3, TEST_ACCOUNTS } from '../context/Web3Context';

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
  { to: '/trading', label: 'Trading', icon: BarChart3 },
  { to: '/markets', label: 'Market Management', icon: Store, adminOnly: true },
  { to: '/compliance', label: 'Compliance Rules', icon: Scale, adminOnly: true },
  { to: '/tokens', label: 'Token Management', icon: Building2, adminOnly: true },
  { to: '/custody', label: 'Wallet Custody', icon: Vault, adminOnly: true },
  { to: '/governance', label: 'Governance', icon: Vote },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { account, chainId, roles, rolesLoading, isConnecting, wrongNetwork, walletMode, connect, connectWithKey, disconnect } = useWeb3();
  const location = useLocation();
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [keyError, setKeyError] = useState('');

  const isAdminOrAgent = roles.isAdmin || roles.isAgent;
  const shortAddr = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : '';

  const handleTestAccount = async (key: string) => {
    setShowWalletMenu(false);
    setShowCustomKey(false);
    await connectWithKey(key);
  };

  const handleCustomKey = async () => {
    const trimmed = customKey.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      setKeyError('Invalid private key format (expected 0x + 64 hex chars)');
      return;
    }
    setKeyError('');
    setShowWalletMenu(false);
    setShowCustomKey(false);
    setCustomKey('');
    await connectWithKey(trimmed);
  };

  // Push everything down when the wrong-network banner is visible
  const bannerOffset = wrongNetwork ? 'pt-12' : '';

  return (
    <div className={`min-h-screen flex ${bannerOffset}`}>
      {/* ── Sidebar ── */}
      <aside className={`w-64 bg-black/20 backdrop-blur-xl border-r border-white/10 h-screen flex flex-col fixed left-0 ${wrongNetwork ? 'top-12' : 'top-0'} z-50`}>
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
              <span className="block text-gray-500 mb-0.5">
                Connected{walletMode === 'builtin' ? ' (Built-in)' : walletMode === 'metamask' ? ' (MetaMask)' : ''}
              </span>
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
            <div className="relative">
              <button
                onClick={() => setShowWalletMenu(!showWalletMenu)}
                disabled={isConnecting}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-purple-400 hover:bg-purple-500/10 rounded-xl transition-colors"
              >
                <Wallet size={20} />
                {isConnecting ? 'Connecting…' : 'Connect Wallet'}
                <ChevronDown size={14} className={`ml-auto transition-transform ${showWalletMenu ? 'rotate-180' : ''}`} />
              </button>

              {showWalletMenu && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[100]">
                  {/* MetaMask option */}
                  {typeof window !== 'undefined' && !!(window as unknown as { ethereum?: unknown }).ethereum && (
                    <button
                      onClick={() => { setShowWalletMenu(false); connect(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-white/5 transition-colors border-b border-white/5"
                    >
                      <Wallet size={16} className="text-orange-400" />
                      MetaMask
                    </button>
                  )}

                  {/* Test accounts */}
                  <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    Built-in Test Accounts
                  </div>
                  {TEST_ACCOUNTS.map((ta) => (
                    <button
                      key={ta.address}
                      onClick={() => handleTestAccount(ta.key)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors"
                    >
                      <Key size={14} className="text-green-400 shrink-0" />
                      <div className="text-left min-w-0">
                        <div className="truncate">{ta.label}</div>
                        <div className="text-[10px] text-gray-500 truncate">{ta.address}</div>
                      </div>
                    </button>
                  ))}

                  {/* Custom key */}
                  <div className="border-t border-white/5">
                    <button
                      onClick={() => setShowCustomKey(!showCustomKey)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-400 hover:bg-white/5 transition-colors"
                    >
                      <Key size={14} className="text-purple-400" />
                      Custom Private Key
                      <ChevronDown size={12} className={`ml-auto transition-transform ${showCustomKey ? 'rotate-180' : ''}`} />
                    </button>
                    {showCustomKey && (
                      <div className="px-4 pb-3 space-y-2">
                        <input
                          type="password"
                          value={customKey}
                          onChange={(e) => { setCustomKey(e.target.value); setKeyError(''); }}
                          placeholder="0x..."
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
                        />
                        {keyError && <p className="text-[10px] text-red-400">{keyError}</p>}
                        <button
                          onClick={handleCustomKey}
                          className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs py-2 rounded-lg transition-colors font-medium"
                        >
                          Connect
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
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
