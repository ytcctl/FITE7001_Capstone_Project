import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../context/Web3Context';
import { SECURITY_TOKEN_ABI } from '../config/contracts';
import {
  PlusCircle,
  Coins,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Loader2,
  Building2,
  AlertTriangle,
  ArrowUpCircle,
  Shield,
  RefreshCw,
} from 'lucide-react';

interface StartupToken {
  name: string;
  symbol: string;
  tokenAddress: string;
  createdBy: string;
  createdAt: number;
  active: boolean;
  totalSupply?: string;
}

interface StartupTokenV2 {
  name: string;
  symbol: string;
  proxyAddress: string;
  createdBy: string;
  createdAt: number;
  active: boolean;
  totalSupply?: string;
}

const TokenManagement: React.FC = () => {
  const { contracts, account, provider } = useWeb3();

  // Tab: v1 or v2
  const [activeTab, setActiveTab] = useState<'v1' | 'v2'>('v1');

  // Create token form
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Token list (V1)
  const [tokens, setTokens] = useState<StartupToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // V2 state
  const [tokensV2, setTokensV2] = useState<StartupTokenV2[]>([]);
  const [isLoadingV2, setIsLoadingV2] = useState(true);
  const [v2TokenName, setV2TokenName] = useState('');
  const [v2TokenSymbol, setV2TokenSymbol] = useState('');
  const [isCreatingV2, setIsCreatingV2] = useState(false);
  const [createErrorV2, setCreateErrorV2] = useState<string | null>(null);
  const [createSuccessV2, setCreateSuccessV2] = useState<string | null>(null);
  const [currentImpl, setCurrentImpl] = useState('');
  const [newImpl, setNewImpl] = useState('');
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [upgradeStatus, setUpgradeStatus] = useState<string | null>(null);

  /** Fetch all tokens from the factory */
  const loadTokens = useCallback(async () => {
    if (!contracts || !provider) return;
    setIsLoading(true);
    try {
      const all = await contracts.tokenFactory.allTokens();
      const enriched: StartupToken[] = await Promise.all(
        all.map(async (t: StartupToken) => {
          let totalSupply = '0';
          try {
            const token = new ethers.Contract(t.tokenAddress, SECURITY_TOKEN_ABI, provider);
            const supply = await token.totalSupply();
            totalSupply = ethers.formatEther(supply);
          } catch {
            // token may not have totalSupply if address is invalid
          }
          return {
            name: t.name,
            symbol: t.symbol,
            tokenAddress: t.tokenAddress,
            createdBy: t.createdBy,
            createdAt: Number(t.createdAt),
            active: t.active,
            totalSupply,
          };
        })
      );
      setTokens(enriched);
    } catch (err) {
      console.error('Failed to load tokens:', err);
    } finally {
      setIsLoading(false);
    }
  }, [contracts, provider]);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  /** Create a new startup token */
  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contracts) return;

    setIsCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      const tx = await contracts.tokenFactory.createToken(tokenName, tokenSymbol);
      const receipt = await tx.wait();

      // Extract TokenCreated event
      const event = receipt.logs.find(
        (log: ethers.Log) => {
          try {
            const parsed = contracts.tokenFactory.interface.parseLog({
              topics: log.topics as string[],
              data: log.data,
            });
            return parsed?.name === 'TokenCreated';
          } catch {
            return false;
          }
        }
      );

      let newAddress = '';
      if (event) {
        const parsed = contracts.tokenFactory.interface.parseLog({
          topics: event.topics as string[],
          data: event.data,
        });
        newAddress = parsed?.args?.tokenAddress || '';
      }

      // Auto-register the new token in WalletRegistry for custody tracking
      if (newAddress && contracts.walletRegistry) {
        try {
          const trackTx = await contracts.walletRegistry.addTrackedToken(newAddress);
          await trackTx.wait();
        } catch (trackErr) {
          console.warn('Auto-track token in WalletRegistry failed:', trackErr);
        }        // Auto-safe-list MultiSigWarm on the new token so custody transfers work
        try {
          const newToken = new ethers.Contract(newAddress, ['function setSafeList(address,bool)'], contracts.securityToken.runner);
          const msAddr = await contracts.multiSigWarm.getAddress();
          const safeTx = await newToken.setSafeList(msAddr, true);
          await safeTx.wait();
        } catch (safeErr) {
          console.warn('Auto-safe-list MultiSigWarm on new token failed:', safeErr);
        }      }

      setCreateSuccess(
        `✅ Token "${tokenName}" (${tokenSymbol}) created at ${newAddress}`
      );
      setTokenName('');
      setTokenSymbol('');
      loadTokens();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message?.includes('SymbolAlreadyExists')) {
        setCreateError(`Symbol "${tokenSymbol}" already exists. Choose a different symbol.`);
      } else if (error.message?.includes('EmptyNameOrSymbol')) {
        setCreateError('Token name and symbol cannot be empty.');
      } else {
        setCreateError(error.message || 'Failed to create token');
      }
    } finally {
      setIsCreating(false);
    }
  };

  /** Toggle token active/inactive */
  const handleToggleActive = async (index: number, currentlyActive: boolean) => {
    if (!contracts) return;
    try {
      const tx = currentlyActive
        ? await contracts.tokenFactory.deactivateToken(index)
        : await contracts.tokenFactory.reactivateToken(index);
      await tx.wait();
      loadTokens();
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  // ── V2 Factory Logic ────────────────────────────────────────────

  /** Fetch all tokens from V2 factory */
  const loadTokensV2 = useCallback(async () => {
    if (!contracts || !provider) return;
    setIsLoadingV2(true);
    try {
      const [all, impl] = await Promise.all([
        contracts.tokenFactoryV2.allTokens(),
        contracts.tokenFactoryV2.currentImplementation(),
      ]);
      setCurrentImpl(impl);
      const enriched: StartupTokenV2[] = await Promise.all(
        all.map(async (t: StartupTokenV2) => {
          let totalSupply = '0';
          try {
            const token = new ethers.Contract(t.proxyAddress, SECURITY_TOKEN_ABI, provider);
            const supply = await token.totalSupply();
            totalSupply = ethers.formatEther(supply);
          } catch { /* proxy may not be initialized */ }
          return {
            name: t.name,
            symbol: t.symbol,
            proxyAddress: t.proxyAddress,
            createdBy: t.createdBy,
            createdAt: Number(t.createdAt),
            active: t.active,
            totalSupply,
          };
        })
      );
      setTokensV2(enriched);
    } catch (err) {
      console.error('Failed to load V2 tokens:', err);
    } finally {
      setIsLoadingV2(false);
    }
  }, [contracts, provider]);

  useEffect(() => { loadTokensV2(); }, [loadTokensV2]);

  /** Create token via V2 factory (ERC-1967 proxy) */
  const handleCreateTokenV2 = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contracts) return;
    setIsCreatingV2(true);
    setCreateErrorV2(null);
    setCreateSuccessV2(null);
    try {
      const tx = await contracts.tokenFactoryV2.createToken(v2TokenName, v2TokenSymbol);
      const receipt = await tx.wait();
      const event = receipt.logs.find((log: ethers.Log) => {
        try {
          const parsed = contracts.tokenFactoryV2.interface.parseLog({ topics: log.topics as string[], data: log.data });
          return parsed?.name === 'TokenCreated';
        } catch { return false; }
      });
      let newAddress = '';
      if (event) {
        const parsed = contracts.tokenFactoryV2.interface.parseLog({ topics: event.topics as string[], data: event.data });
        newAddress = parsed?.args?.proxyAddress || '';
      }

      // Auto-register the new token in WalletRegistry for custody tracking
      if (newAddress && contracts.walletRegistry) {
        try {
          const trackTx = await contracts.walletRegistry.addTrackedToken(newAddress);
          await trackTx.wait();
        } catch (trackErr) {
          console.warn('Auto-track V2 token in WalletRegistry failed:', trackErr);
        }        // Auto-safe-list MultiSigWarm on the new token so custody transfers work
        try {
          const newToken = new ethers.Contract(newAddress, ['function setSafeList(address,bool)'], contracts.securityToken.runner);
          const msAddr = await contracts.multiSigWarm.getAddress();
          const safeTx = await newToken.setSafeList(msAddr, true);
          await safeTx.wait();
        } catch (safeErr) {
          console.warn('Auto-safe-list MultiSigWarm on new V2 token failed:', safeErr);
        }      }

      setCreateSuccessV2(`✅ Upgradeable token "${v2TokenName}" (${v2TokenSymbol}) created at ${newAddress}`);
      setV2TokenName('');
      setV2TokenSymbol('');
      loadTokensV2();
    } catch (err: unknown) {
      const error = err as Error;
      if (error.message?.includes('SymbolAlreadyExists')) {
        setCreateErrorV2(`Symbol "${v2TokenSymbol}" already exists.`);
      } else if (error.message?.includes('EmptyNameOrSymbol')) {
        setCreateErrorV2('Token name and symbol cannot be empty.');
      } else {
        setCreateErrorV2(error.message || 'Failed to create V2 token');
      }
    } finally {
      setIsCreatingV2(false);
    }
  };

  /** Toggle V2 token active/inactive */
  const handleToggleActiveV2 = async (index: number, currentlyActive: boolean) => {
    if (!contracts) return;
    try {
      const tx = currentlyActive
        ? await contracts.tokenFactoryV2.deactivateToken(index)
        : await contracts.tokenFactoryV2.reactivateToken(index);
      await tx.wait();
      loadTokensV2();
    } catch (err) {
      console.error('V2 toggle failed:', err);
    }
  };

  /** Upgrade all V2 proxy implementations */
  const handleUpgrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contracts || !newImpl) return;
    setIsUpgrading(true);
    setUpgradeStatus(null);
    try {
      const tx = await contracts.tokenFactoryV2.upgradeImplementation(newImpl);
      await tx.wait();
      setUpgradeStatus(`✅ All V2 tokens upgraded to new implementation: ${newImpl}`);
      setNewImpl('');
      loadTokensV2();
    } catch (err: unknown) {
      const error = err as Error;
      setUpgradeStatus(`❌ ${error.message || 'Upgrade failed'}`);
    } finally {
      setIsUpgrading(false);
    }
  };

  const shortAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Building2 className="text-purple-400" size={32} />
          Token Management
        </h1>
        <p className="text-gray-400 mt-2">
          Create and manage security tokens for approved HKSTP startup companies.
          Each token is an ERC-3643 compliant security token linked to the shared
          KYC Identity Registry and Compliance engine.
        </p>
      </div>

      {/* Tab Switcher */}
      <div className="flex gap-2 bg-white/5 border border-white/10 rounded-xl p-1">
        <button
          onClick={() => setActiveTab('v1')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            activeTab === 'v1'
              ? 'bg-purple-600 text-white shadow-lg'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Coins size={16} />
          V1 — Immutable Clones (EIP-1167)
        </button>
        <button
          onClick={() => setActiveTab('v2')}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            activeTab === 'v2'
              ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <ArrowUpCircle size={16} />
          V2 — Upgradeable Proxies (ERC-1967)
        </button>
      </div>

      {/* ═══════ V1 TAB ═══════ */}
      {activeTab === 'v1' && (
        <>
          {/* Create Token Form */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <PlusCircle size={20} className="text-green-400" />
              Create New Startup Token (V1 — Immutable)
            </h2>
            <form onSubmit={handleCreateToken} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Token Name</label>
                  <input type="text" value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="e.g. HKSTP BioTech Alpha Token"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Token Symbol</label>
                  <input type="text" value={tokenSymbol} onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())} placeholder="e.g. HKBA" maxLength={10}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition uppercase" required />
                </div>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-sm text-yellow-300 flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>This deploys an <strong>immutable EIP-1167 clone</strong>. If you need upgradeability, use the V2 tab.</span>
              </div>
              <button type="submit" disabled={isCreating || !tokenName || !tokenSymbol}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-xl hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2">
                {isCreating ? (<><Loader2 size={18} className="animate-spin" /> Deploying…</>) : (<><PlusCircle size={18} /> Create Token</>)}
              </button>
              {createError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 flex items-center gap-2"><XCircle size={16} />{createError}</div>
              )}
              {createSuccess && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-sm text-green-400 flex items-center gap-2"><CheckCircle2 size={16} />{createSuccess}</div>
              )}
            </form>
          </div>

          {/* V1 Token List */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Coins size={20} className="text-blue-400" />
              V1 Tokens (Immutable Clones)
              <span className="ml-auto text-sm font-normal text-gray-400">{tokens.length} token{tokens.length !== 1 ? 's' : ''}</span>
            </h2>
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="animate-spin mr-2" size={20} /> Loading…</div>
            ) : tokens.length === 0 ? (
              <div className="text-center py-12 text-gray-500"><Coins size={48} className="mx-auto mb-3 opacity-30" /><p>No V1 tokens yet.</p></div>
            ) : (
              <div className="space-y-3">
                {tokens.map((token, index) => (
                  <div key={token.tokenAddress} className={`border rounded-xl p-4 transition-all ${token.active ? 'bg-white/5 border-white/10 hover:border-white/20' : 'bg-red-500/5 border-red-500/10 opacity-60'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${token.active ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white' : 'bg-gray-700 text-gray-400'}`}>{token.symbol.slice(0, 3)}</div>
                        <div>
                          <div className="font-medium text-white flex items-center gap-2">
                            {token.name}
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${token.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{token.active ? 'ACTIVE' : 'INACTIVE'}</span>
                          </div>
                          <div className="text-sm text-gray-400 flex items-center gap-3 mt-0.5">
                            <span className="font-mono">{token.symbol}</span><span>·</span>
                            <span className="font-mono text-xs">{shortAddr(token.tokenAddress)}</span><span>·</span>
                            <span>Supply: {parseFloat(token.totalSupply || '0').toLocaleString()}</span><span>·</span>
                            <span>Created: {new Date(token.createdAt * 1000).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => navigator.clipboard.writeText(token.tokenAddress)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition" title="Copy address"><ExternalLink size={16} /></button>
                        {account && (
                          <button onClick={() => handleToggleActive(index, token.active)} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${token.active ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'}`}>{token.active ? 'Deactivate' : 'Reactivate'}</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ═══════ V2 TAB ═══════ */}
      {activeTab === 'v2' && (
        <>
          {/* Implementation Info */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
            <div className="flex items-center gap-3 mb-2">
              <Shield size={20} className="text-blue-400" />
              <h2 className="text-lg font-semibold text-white">Current Implementation</h2>
            </div>
            <p className="font-mono text-sm text-gray-300 break-all">{currentImpl || '—'}</p>
            <p className="text-xs text-gray-500 mt-2">
              All V2 tokens are ERC-1967 proxies pointing to this implementation. An upgrade changes <strong>all</strong> tokens atomically.
            </p>
          </div>

          {/* Create V2 Token */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <PlusCircle size={20} className="text-green-400" />
              Create Upgradeable Token (V2 — ERC-1967 Proxy)
            </h2>
            <form onSubmit={handleCreateTokenV2} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Token Name</label>
                  <input type="text" value={v2TokenName} onChange={(e) => setV2TokenName(e.target.value)} placeholder="e.g. HKSTP BioTech Beta Token"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Token Symbol</label>
                  <input type="text" value={v2TokenSymbol} onChange={(e) => setV2TokenSymbol(e.target.value.toUpperCase())} placeholder="e.g. HKBB" maxLength={10}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition uppercase" required />
                </div>
              </div>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-sm text-blue-300 flex items-start gap-2">
                <ArrowUpCircle size={16} className="mt-0.5 shrink-0" />
                <span>This deploys an <strong>upgradeable ERC-1967 proxy</strong>. The token implementation can be upgraded later via governance without changing the token address.</span>
              </div>
              <button type="submit" disabled={isCreatingV2 || !v2TokenName || !v2TokenSymbol}
                className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-xl hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2">
                {isCreatingV2 ? (<><Loader2 size={18} className="animate-spin" /> Deploying Proxy…</>) : (<><PlusCircle size={18} /> Create Upgradeable Token</>)}
              </button>
              {createErrorV2 && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 flex items-center gap-2"><XCircle size={16} />{createErrorV2}</div>
              )}
              {createSuccessV2 && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-sm text-green-400 flex items-center gap-2"><CheckCircle2 size={16} />{createSuccessV2}</div>
              )}
            </form>
          </div>

          {/* Upgrade Implementation */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <ArrowUpCircle size={20} className="text-amber-400" />
              Upgrade All Token Implementations
            </h2>
            <form onSubmit={handleUpgrade} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">New Implementation Address</label>
                <input type="text" value={newImpl} onChange={(e) => setNewImpl(e.target.value)} placeholder="0x… (new HKSTPSecurityToken implementation)"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 transition font-mono text-sm" required />
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-300 flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span>⚠ This upgrades <strong>ALL {tokensV2.length} V2 token(s)</strong> atomically. Requires UPGRADER_ROLE (typically via Timelock governance). Ensure the new implementation is audited.</span>
              </div>
              <button type="submit" disabled={isUpgrading || !newImpl}
                className="px-6 py-3 bg-gradient-to-r from-amber-600 to-red-600 text-white font-medium rounded-xl hover:from-amber-500 hover:to-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2">
                {isUpgrading ? (<><Loader2 size={18} className="animate-spin" /> Upgrading…</>) : (<><ArrowUpCircle size={18} /> Upgrade Implementation</>)}
              </button>
              {upgradeStatus && (
                <div className={`rounded-xl p-3 text-sm flex items-center gap-2 ${upgradeStatus.startsWith('✅') ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  {upgradeStatus.startsWith('✅') ? <CheckCircle2 size={16} /> : <XCircle size={16} />}{upgradeStatus}
                </div>
              )}
            </form>
          </div>

          {/* V2 Token List */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <ArrowUpCircle size={20} className="text-blue-400" />
              V2 Tokens (Upgradeable Proxies)
              <span className="ml-auto text-sm font-normal text-gray-400 flex items-center gap-2">
                {tokensV2.length} token{tokensV2.length !== 1 ? 's' : ''}
                <button onClick={loadTokensV2} className="p-1 text-gray-400 hover:text-white hover:bg-white/10 rounded transition" title="Refresh"><RefreshCw size={14} /></button>
              </span>
            </h2>
            {isLoadingV2 ? (
              <div className="flex items-center justify-center py-12 text-gray-400"><Loader2 className="animate-spin mr-2" size={20} /> Loading…</div>
            ) : tokensV2.length === 0 ? (
              <div className="text-center py-12 text-gray-500"><ArrowUpCircle size={48} className="mx-auto mb-3 opacity-30" /><p>No V2 tokens yet.</p><p className="text-sm mt-1">Use the form above to create the first upgradeable token.</p></div>
            ) : (
              <div className="space-y-3">
                {tokensV2.map((token, index) => (
                  <div key={token.proxyAddress} className={`border rounded-xl p-4 transition-all ${token.active ? 'bg-white/5 border-white/10 hover:border-white/20' : 'bg-red-500/5 border-red-500/10 opacity-60'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${token.active ? 'bg-gradient-to-br from-amber-500 to-pink-500 text-white' : 'bg-gray-700 text-gray-400'}`}>{token.symbol.slice(0, 3)}</div>
                        <div>
                          <div className="font-medium text-white flex items-center gap-2">
                            {token.name}
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${token.active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{token.active ? 'ACTIVE' : 'INACTIVE'}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400">UPGRADEABLE</span>
                          </div>
                          <div className="text-sm text-gray-400 flex items-center gap-3 mt-0.5">
                            <span className="font-mono">{token.symbol}</span><span>·</span>
                            <span className="font-mono text-xs">{shortAddr(token.proxyAddress)}</span><span>·</span>
                            <span>Supply: {parseFloat(token.totalSupply || '0').toLocaleString()}</span><span>·</span>
                            <span>Created: {new Date(token.createdAt * 1000).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => navigator.clipboard.writeText(token.proxyAddress)} className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition" title="Copy proxy address"><ExternalLink size={16} /></button>
                        {account && (
                          <button onClick={() => handleToggleActiveV2(index, token.active)} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${token.active ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'}`}>{token.active ? 'Deactivate' : 'Reactivate'}</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default TokenManagement;
