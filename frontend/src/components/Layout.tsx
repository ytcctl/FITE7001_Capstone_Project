import React, { useState, useEffect } from 'react';
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
  Shield,
  Vote,
  Vault,
  BarChart3,
  Store,
  Key,
  ChevronDown,
  X,
  UserPlus,
  ShieldAlert,
  Snowflake,
  Menu,
} from 'lucide-react';
import { useWeb3, TEST_ACCOUNTS, getSavedAccounts, removeSavedAccount } from '../context/Web3Context';
import type { SavedAccount } from '../context/Web3Context';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Short hover description explaining what this tab does. */
  description: string;
  /** Visible to Admin + Agent (Agent has AGENT_ROLE on the contract) */
  adminOrAgent?: boolean;
  /** Visible to Admin only (Agent has no on-chain role) */
  adminOnly?: boolean;
  /** Visible to Admin + Agent + Operator (Oracle: all 3 are members) */
  privileged?: boolean;
}

const navItems: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Overview of system status, your portfolio balances, and recent on-chain activity.',
  },
  {
    to: '/kyc',
    label: 'KYC Management',
    icon: ShieldCheck,
    adminOrAgent: true,
    description: 'Register investor identities, set ERC-735 KYC claims, and verify wallets for trading.',
  },
  {
    to: '/mint',
    label: 'Token Minting',
    icon: Coins,
    adminOrAgent: true,
    description: 'Issue new HKSAT security tokens or THKD cash tokens to KYC-verified addresses.',
  },
  {
    to: '/settlement',
    label: 'DvP Settlement',
    icon: ArrowRightLeft,
    description: 'Create and execute atomic Delivery-vs-Payment settlements between buyer and seller.',
  },
  {
    to: '/trading',
    label: 'Trading',
    icon: BarChart3,
    description: 'Place buy/sell orders on the on-chain order book and view your order history.',
  },
  {
    to: '/markets',
    label: 'Market Management',
    icon: Store,
    adminOnly: true,
    description: 'Configure trading pairs, fees, and market parameters for the order book.',
  },
  {
    to: '/compliance',
    label: 'Compliance Rules',
    icon: Scale,
    adminOnly: true,
    description: 'Manage country restrictions, transfer limits, and Cap. 622 shareholder caps.',
  },
  {
    to: '/oracle',
    label: 'Oracle Committee',
    icon: ShieldAlert,
    privileged: true,
    description: 'Multi-signer oracle for compliance attestations and off-chain data feeds.',
  },
  {
    to: '/tokens',
    label: 'Token Management',
    icon: Building2,
    adminOnly: true,
    description: 'Deploy new security tokens via the factory and manage existing token metadata.',
  },
  {
    to: '/custody',
    label: 'Wallet Custody',
    icon: Vault,
    privileged: true,
    description: 'Multi-signature warm-wallet custody for institutional asset safekeeping.',
  },
  {
    to: '/freeze',
    label: 'Freeze Management',
    icon: Snowflake,
    adminOrAgent: true,
    description: 'Freeze or unfreeze investor wallets and tokens to enforce regulatory holds.',
  },
  {
    to: '/governance',
    label: 'Governance',
    icon: Vote,
    description: 'Create proposals, delegate votes, and participate in on-chain governance.',
  },
  {
    to: '/portfolio',
    label: 'Portfolio',
    icon: Briefcase,
    description: 'View your token balances, transaction history, and KYC status.',
  },
  {
    to: '/mint-eth',
    label: 'Mint ETH (Test)',
    icon: Sparkles,
    adminOnly: true,
    description: 'Test-only utility to top up dev accounts with ETH on the local devnet.',
  },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { account, chainId, roles, rolesLoading, isConnecting, wrongNetwork, walletMode, connect, connectWithKey, disconnect } = useWeb3();
  const location = useLocation();
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [customKey, setCustomKey] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [keyError, setKeyError] = useState('');
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Auto-close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  // Load saved accounts from localStorage when menu opens
  useEffect(() => {
    if (showWalletMenu) setSavedAccounts(getSavedAccounts());
  }, [showWalletMenu]);

  const isAdminOrAgent = roles.isAdmin || roles.isAgent;
  const isPrivileged = roles.isAdmin || roles.isAgent || roles.isOperator;
  const shortAddr = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : '';

  const handleTestAccount = async (key: string) => {
    setShowWalletMenu(false);
    setShowCustomKey(false);
    await connectWithKey(key);
  };

  const handleSavedAccount = async (sa: SavedAccount) => {
    setShowWalletMenu(false);
    setShowCustomKey(false);
    await connectWithKey(sa.key);
  };

  const handleRemoveSaved = (e: React.MouseEvent, address: string) => {
    e.stopPropagation();
    removeSavedAccount(address);
    setSavedAccounts(getSavedAccounts());
  };

  const handleCustomKey = async () => {
    let trimmed = customKey.trim();
    // Accept keys without 0x prefix (e.g. copied from MetaMask)
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      trimmed = `0x${trimmed}`;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
      // Detect common mistake: user pasted an address (40 hex) instead of a private key (64 hex)
      const hexOnly = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
      if (/^[0-9a-fA-F]{40}$/.test(hexOnly)) {
        setKeyError('This looks like a wallet address (40 hex chars), not a private key. A private key is 64 hex chars. Export it from MetaMask → Account Details → Show Private Key.');
      } else {
        setKeyError('Invalid private key format (expected 64 hex chars, with or without 0x prefix)');
      }
      return;
    }
    const label = customLabel.trim() || `Account ${savedAccounts.length + 1}`;
    setKeyError('');
    setShowWalletMenu(false);
    setShowCustomKey(false);
    setCustomKey('');
    setCustomLabel('');
    await connectWithKey(trimmed, label);
  };

  // Push everything down when the wrong-network banner is visible
  const bannerOffset = wrongNetwork ? 'pt-12' : '';

  return (
    <div className={`min-h-screen flex ${bannerOffset}`}>
      {/* ── Mobile top bar ── */}
      <div className={`md:hidden fixed ${wrongNetwork ? 'top-12' : 'top-0'} left-0 right-0 z-[60] flex items-center gap-2 px-2 py-2 bg-black/40 backdrop-blur border-b border-white/10`}>
        <button
          onClick={() => setSidebarOpen(true)}
          className="p-2 rounded-lg text-white"
          aria-label="Open menu"
        >
          <Menu size={22} />
        </button>
        <span className="text-white font-bold text-sm flex-1">TokenHub</span>
        {!account && (
          <button
            onClick={() => setShowWalletMenu((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-300 bg-purple-500/20 rounded-lg border border-purple-500/30"
          >
            <Wallet size={14} />
            Connect
          </button>
        )}
        {account && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 truncate max-w-[100px]">{shortAddr}</span>
            <button
              onClick={disconnect}
              className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
              aria-label="Disconnect"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>

      {/* ── Mobile wallet dropdown (top-right, below top bar) ── */}
      {showWalletMenu && !account && (
        <>
          <div className="md:hidden fixed inset-0 z-[70]" onClick={() => setShowWalletMenu(false)} />
          <div className={`md:hidden fixed right-2 ${wrongNetwork ? 'top-[4.5rem]' : 'top-12'} w-72 bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-y-auto max-h-[80vh] z-[80]`}>
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
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">Built-in Test Accounts</div>
            {TEST_ACCOUNTS.map((ta) => (
              <button key={ta.address} onClick={() => handleTestAccount(ta.key)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors">
                <Key size={14} className="text-green-400 shrink-0" />
                <div className="text-left min-w-0">
                  <div className="truncate">{ta.label}</div>
                  <div className="text-[10px] text-gray-500 truncate">{ta.address}</div>
                </div>
              </button>
            ))}
            {/* Saved accounts */}
            {savedAccounts.length > 0 && (
              <>
                <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-t border-white/5">Saved Accounts</div>
                {savedAccounts.map((sa) => (
                  <button key={sa.address} onClick={() => handleSavedAccount(sa)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors group">
                    <UserPlus size={14} className="text-cyan-400 shrink-0" />
                    <div className="text-left min-w-0 flex-1">
                      <div className="truncate">{sa.label}</div>
                      <div className="text-[10px] text-gray-500 truncate">{sa.address}</div>
                    </div>
                    <span role="button" onClick={(e) => handleRemoveSaved(e, sa.address)} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1" title="Remove saved account"><X size={12} /></span>
                  </button>
                ))}
              </>
            )}
            {/* Custom key */}
            <div className="border-t border-white/5">
              <button onClick={() => setShowCustomKey(!showCustomKey)} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-400 hover:bg-white/5 transition-colors">
                <Key size={14} className="text-purple-400" />
                Custom Private Key
                <ChevronDown size={12} className={`ml-auto transition-transform ${showCustomKey ? 'rotate-180' : ''}`} />
              </button>
              {showCustomKey && (
                <div className="px-4 pb-3 space-y-2">
                  <input type="text" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Label (e.g. Investor2)" className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500" />
                  <input type="password" value={customKey} onChange={(e) => { setCustomKey(e.target.value); setKeyError(''); }} placeholder="0x..." className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500" />
                  {keyError && <p className="text-[10px] text-red-400">{keyError}</p>}
                  <button onClick={handleCustomKey} className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs py-2 rounded-lg transition-colors font-medium">Connect & Save</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Backdrop (mobile) ── */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={`w-64 bg-black/20 backdrop-blur-xl border-r border-white/10 h-screen flex flex-col fixed left-0 ${wrongNetwork ? 'top-12' : 'top-0'} z-50 transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
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

        {/* Scrollable body (nav + wallet) */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <nav className="flex-1 p-4 space-y-1.5 mt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.to;
            // adminOnly = admin-only pages; adminOrAgent = admin + agent; privileged = admin + agent + operator
            const isRestricted = item.adminOnly || item.adminOrAgent || item.privileged;
            const isHidden =
              !rolesLoading &&
              ((item.adminOnly && !roles.isAdmin) ||
               (item.adminOrAgent && !isAdminOrAgent) ||
               (item.privileged && !isPrivileged));

            if (isHidden) return null;

            return (
              <div key={item.to} className="group relative">
                <NavLink
                  to={item.to}
                  title={item.description}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? 'bg-white/10 text-white shadow-sm border border-white/5'
                      : 'text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <Icon size={20} className={isActive ? 'text-purple-400' : 'text-gray-500'} />
                  {item.label}
                  {item.adminOnly && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-yellow-400/70">
                      <Shield size={10} />
                      Admin
                    </span>
                  )}
                  {item.adminOrAgent && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-orange-400/70">
                      <Shield size={10} />
                      Staff
                    </span>
                  )}
                  {item.privileged && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-green-400/70">
                      <Shield size={10} />
                      Privileged
                    </span>
                  )}
                </NavLink>
                {/* Custom hover tooltip (desktop only — fades in on hover) */}
                <div
                  role="tooltip"
                  className="hidden md:block pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 w-64 z-[120] opacity-0 group-hover:opacity-100 transition-opacity duration-150 delay-150"
                >
                  <div className="bg-gray-900/95 backdrop-blur border border-white/10 text-gray-200 text-xs rounded-xl shadow-2xl px-3 py-2 leading-relaxed">
                    <div className="font-semibold text-white mb-1">{item.label}</div>
                    {item.description}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="shrink-0 p-4 border-t border-white/10 space-y-2">
          {account && (
            <div className="px-4 py-2 text-xs text-gray-400">
              <span className="block text-gray-500 mb-0.5">
                Connected{walletMode === 'builtin' ? ' (Built-in)' : walletMode === 'metamask' ? ' (MetaMask)' : ''}
              </span>
              <span className="block truncate">{shortAddr} · Chain {chainId}</span>
              <span className={`mt-1 inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                roles.isAdmin
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : roles.isAgent
                    ? 'bg-orange-500/20 text-orange-400'
                    : roles.isOperator
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-blue-500/20 text-blue-400'
              }`}>
                {rolesLoading ? '…' : roles.isAdmin ? 'ADMIN' : roles.isAgent ? 'AGENT' : roles.isOperator ? 'OPERATOR' : 'INVESTOR'}
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
                <div className="hidden md:block absolute bottom-full left-0 right-0 mb-2 bg-gray-900 border border-white/10 rounded-xl shadow-2xl overflow-y-auto max-h-[70vh] z-[100]">
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

                  {/* Saved accounts */}
                  {savedAccounts.length > 0 && (
                    <>
                      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 font-semibold border-t border-white/5">
                        Saved Accounts
                      </div>
                      {savedAccounts.map((sa) => (
                        <button
                          key={sa.address}
                          onClick={() => handleSavedAccount(sa)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5 transition-colors group"
                        >
                          <UserPlus size={14} className="text-cyan-400 shrink-0" />
                          <div className="text-left min-w-0 flex-1">
                            <div className="truncate">{sa.label}</div>
                            <div className="text-[10px] text-gray-500 truncate">{sa.address}</div>
                          </div>
                          <span
                            role="button"
                            onClick={(e) => handleRemoveSaved(e, sa.address)}
                            className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1"
                            title="Remove saved account"
                          >
                            <X size={12} />
                          </span>
                        </button>
                      ))}
                    </>
                  )}

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
                          type="text"
                          value={customLabel}
                          onChange={(e) => setCustomLabel(e.target.value)}
                          placeholder="Label (e.g. Investor2)"
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-purple-500"
                        />
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
                          Connect & Save
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        </div>{/* end scrollable body */}
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 ml-0 md:ml-64 p-3 pt-14 md:p-8 md:pt-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
};

export default Layout;
