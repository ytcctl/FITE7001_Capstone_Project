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

const TokenManagement: React.FC = () => {
  const { contracts, account, provider } = useWeb3();

  // Create token form
  const [tokenName, setTokenName] = useState('');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Token list
  const [tokens, setTokens] = useState<StartupToken[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

      {/* Create Token Form */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <PlusCircle size={20} className="text-green-400" />
          Create New Startup Token
        </h2>

        <form onSubmit={handleCreateToken} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Token Name
              </label>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="e.g. HKSTP BioTech Alpha Token"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Token Symbol
              </label>
              <input
                type="text"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. HKBA"
                maxLength={10}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition uppercase"
                required
              />
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-sm text-yellow-300 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              This will deploy a new ERC-3643 security token on-chain. The token will be
              automatically linked to the shared KYC registry and compliance rules.
              You (the admin) will have minting rights.
            </span>
          </div>

          <button
            type="submit"
            disabled={isCreating || !tokenName || !tokenSymbol}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white font-medium rounded-xl hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            {isCreating ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Deploying Token…
              </>
            ) : (
              <>
                <PlusCircle size={18} />
                Create Token
              </>
            )}
          </button>

          {createError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-sm text-red-400 flex items-center gap-2">
              <XCircle size={16} />
              {createError}
            </div>
          )}
          {createSuccess && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-sm text-green-400 flex items-center gap-2">
              <CheckCircle2 size={16} />
              {createSuccess}
            </div>
          )}
        </form>
      </div>

      {/* Token List */}
      <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Coins size={20} className="text-blue-400" />
          Registered Startup Tokens
          <span className="ml-auto text-sm font-normal text-gray-400">
            {tokens.length} token{tokens.length !== 1 ? 's' : ''}
          </span>
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="animate-spin mr-2" size={20} />
            Loading tokens…
          </div>
        ) : tokens.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Coins size={48} className="mx-auto mb-3 opacity-30" />
            <p>No startup tokens created yet.</p>
            <p className="text-sm mt-1">Use the form above to create the first one.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tokens.map((token, index) => (
              <div
                key={token.tokenAddress}
                className={`border rounded-xl p-4 transition-all ${
                  token.active
                    ? 'bg-white/5 border-white/10 hover:border-white/20'
                    : 'bg-red-500/5 border-red-500/10 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold ${
                      token.active
                        ? 'bg-gradient-to-br from-purple-500 to-pink-500 text-white'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      {token.symbol.slice(0, 3)}
                    </div>
                    <div>
                      <div className="font-medium text-white flex items-center gap-2">
                        {token.name}
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          token.active
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}>
                          {token.active ? 'ACTIVE' : 'INACTIVE'}
                        </span>
                      </div>
                      <div className="text-sm text-gray-400 flex items-center gap-3 mt-0.5">
                        <span className="font-mono">{token.symbol}</span>
                        <span>·</span>
                        <span className="font-mono text-xs">{shortAddr(token.tokenAddress)}</span>
                        <span>·</span>
                        <span>Supply: {parseFloat(token.totalSupply || '0').toLocaleString()}</span>
                        <span>·</span>
                        <span>Created: {new Date(token.createdAt * 1000).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(token.tokenAddress)}
                      className="p-2 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition"
                      title="Copy contract address"
                    >
                      <ExternalLink size={16} />
                    </button>
                    {account && (
                      <button
                        onClick={() => handleToggleActive(index, token.active)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                          token.active
                            ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                            : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                        }`}
                      >
                        {token.active ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenManagement;
