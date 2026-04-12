import React, { useState, useEffect, useCallback } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { SECURITY_TOKEN_ABI } from '../config/contracts';
import { Coins, Plus, Minus, RefreshCw, Loader2, ChevronDown, Shield, AlertTriangle, Settings, Vote } from 'lucide-react';
import { ethers } from 'ethers';

interface TokenOption {
  name: string;
  symbol: string;
  address: string;
  active: boolean;
}

const TokenMinting: React.FC = () => {
  const { account, contracts, provider } = useWeb3();

  // Available tokens from factory
  const [tokenOptions, setTokenOptions] = useState<TokenOption[]>([]);
  const [selectedTokenAddr, setSelectedTokenAddr] = useState<string>('');

  // Security token
  const [stName, setStName] = useState('');
  const [stSymbol, setStSymbol] = useState('');
  const [stSupply, setStSupply] = useState('0');
  // Cash token
  const [ctSymbol, setCtSymbol] = useState('THKD');
  const [ctSupply, setCtSupply] = useState('0');

  // Supply cap & tiered minting
  const [maxSupply, setMaxSupply] = useState<bigint>(0n);
  const [mintThreshold, setMintThreshold] = useState<bigint>(0n);
  const [stSupplyRaw, setStSupplyRaw] = useState<bigint>(0n);

  // Mint/Burn inputs
  const [mintTo, setMintTo] = useState('');
  const [mintAmount, setMintAmount] = useState('');
  const [burnFrom, setBurnFrom] = useState('');
  const [burnAmount, setBurnAmount] = useState('');
  // Cash mint/burn
  const [cashMintTo, setCashMintTo] = useState('');
  const [cashMintAmount, setCashMintAmount] = useState('');
  const [cashBurnFrom, setCashBurnFrom] = useState('');
  const [cashBurnAmount, setCashBurnAmount] = useState('');

  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Supply safeguard config inputs
  const [showConfig, setShowConfig] = useState(false);
  const [newMaxSupply, setNewMaxSupply] = useState('');
  const [newMintThreshold, setNewMintThreshold] = useState('');

  // Whether connected wallet has DEFAULT_ADMIN_ROLE on the selected token
  const [isTokenAdmin, setIsTokenAdmin] = useState(false);

  /** Helper: get a signer-backed security token contract for the selected address */
  const getSelectedTokenContract = useCallback(() => {
    if (!provider || !selectedTokenAddr || selectedTokenAddr === '') return null;
    // If it's the default security token, use the one from context
    if (contracts && selectedTokenAddr === (contracts.securityToken as ethers.Contract).target) {
      return contracts.securityToken;
    }
    // Otherwise, create a new contract instance for a factory-deployed token
    const signer = (provider as ethers.BrowserProvider).getSigner();
    return signer.then(s => new ethers.Contract(selectedTokenAddr, SECURITY_TOKEN_ABI, s));
  }, [provider, selectedTokenAddr, contracts]);

  /** Load the list of factory-deployed tokens + the default security token */
  const loadTokenOptions = useCallback(async () => {
    if (!contracts) return;
    const options: TokenOption[] = [];

    // Always include the default security token deployed by the deploy script
    try {
      const [name, symbol] = await Promise.all([
        contracts.securityToken.name(),
        contracts.securityToken.symbol(),
      ]);
      const addr = await contracts.securityToken.getAddress();
      options.push({ name, symbol, address: addr, active: true });
    } catch {
      // fallback if the contract isn't available
    }

    // Fetch factory-deployed tokens
    try {
      const all = await contracts.tokenFactory.allTokens();
      for (const t of all) {
        // Avoid duplicate if factory deployed the same default token
        if (options.find(o => o.address.toLowerCase() === t.tokenAddress.toLowerCase())) continue;
        if (t.active) {
          options.push({
            name: t.name,
            symbol: t.symbol,
            address: t.tokenAddress,
            active: t.active,
          });
        }
      }
    } catch {
      // TokenFactory might not be deployed yet — that's fine
    }

    setTokenOptions(options);
    // Default selection: first option
    if (options.length > 0 && !selectedTokenAddr) {
      setSelectedTokenAddr(options[0].address);
    }
  }, [contracts, selectedTokenAddr]);

  const loadInfo = useCallback(async () => {
    if (!contracts || !selectedTokenAddr) return;
    try {
      // Load selected security token info
      let tokenContract: ethers.Contract;
      if (selectedTokenAddr === (contracts.securityToken as ethers.Contract).target) {
        tokenContract = contracts.securityToken as ethers.Contract;
      } else {
        tokenContract = new ethers.Contract(selectedTokenAddr, SECURITY_TOKEN_ABI, provider);
      }

      const [name, sym, supply, cSym, cSupply, cap, threshold] = await Promise.all([
        tokenContract.name(),
        tokenContract.symbol(),
        tokenContract.totalSupply(),
        contracts.cashToken.symbol(),
        contracts.cashToken.totalSupply(),
        tokenContract.maxSupply().catch(() => 0n),
        tokenContract.mintThreshold().catch(() => 0n),
      ]);
      setStName(name);
      setStSymbol(sym);
      setStSupply(ethers.formatUnits(supply, 18));
      setStSupplyRaw(supply);
      setMaxSupply(cap);
      setMintThreshold(threshold);
      setCtSymbol(cSym);
      setCtSupply(ethers.formatUnits(cSupply, 6));

      // Check if connected wallet has DEFAULT_ADMIN_ROLE on this token
      if (account) {
        try {
          const adminRole = await tokenContract.DEFAULT_ADMIN_ROLE();
          const hasAdmin = await tokenContract.hasRole(adminRole, account);
          setIsTokenAdmin(hasAdmin);
        } catch {
          setIsTokenAdmin(false);
        }
      } else {
        setIsTokenAdmin(false);
      }
    } catch (e) {
      console.error('TokenMinting load error:', e);
    }
  }, [contracts, selectedTokenAddr, provider, account]);

  useEffect(() => {
    loadTokenOptions();
  }, [loadTokenOptions]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const handleMint = async () => {
    if (!mintTo || !mintAmount) return;
    setIsSubmitting(true);
    setTxStatus(`Minting ${mintAmount} ${stSymbol}…`);
    try {
      const tokenContract = await getSelectedTokenContract();
      if (!tokenContract) throw new Error('No token selected');
      const tx = await (tokenContract as ethers.Contract).mint(mintTo, ethers.parseUnits(mintAmount, 18));
      await tx.wait();
      setTxStatus(`✓ Minted ${mintAmount} ${stSymbol} to ${mintTo.slice(0, 10)}…`);
      setMintAmount('');
      loadInfo();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Mint failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBurn = async () => {
    if (!burnFrom || !burnAmount) return;
    setIsSubmitting(true);
    setTxStatus(`Burning ${burnAmount} ${stSymbol}…`);
    try {
      const tokenContract = await getSelectedTokenContract();
      if (!tokenContract) throw new Error('No token selected');
      const tx = await (tokenContract as ethers.Contract).burn(burnFrom, ethers.parseUnits(burnAmount, 18));
      await tx.wait();
      setTxStatus(`✓ Burned ${burnAmount} ${stSymbol} from ${burnFrom.slice(0, 10)}…`);
      setBurnAmount('');
      loadInfo();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Burn failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCashMint = async () => {
    if (!contracts || !cashMintTo || !cashMintAmount) return;
    setIsSubmitting(true);
    setTxStatus(`Minting ${cashMintAmount} ${ctSymbol}…`);
    try {
      const tx = await contracts.cashToken.mint(cashMintTo, ethers.parseUnits(cashMintAmount, 6));
      await tx.wait();
      setTxStatus(`✓ Minted ${cashMintAmount} ${ctSymbol} to ${cashMintTo.slice(0, 10)}…`);
      setCashMintAmount('');
      loadInfo();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Mint failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCashBurn = async () => {
    if (!contracts || !cashBurnFrom || !cashBurnAmount) return;
    setIsSubmitting(true);
    setTxStatus(`Burning ${cashBurnAmount} ${ctSymbol}…`);
    try {
      const tx = await contracts.cashToken.burn(cashBurnFrom, ethers.parseUnits(cashBurnAmount, 6));
      await tx.wait();
      setTxStatus(`✓ Burned ${cashBurnAmount} ${ctSymbol} from ${cashBurnFrom.slice(0, 10)}…`);
      setCashBurnAmount('');
      loadInfo();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Burn failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Supply Safeguard Configuration ──

  const handleSetMaxSupply = async () => {
    setIsSubmitting(true);
    const value = newMaxSupply.trim() === '' || newMaxSupply.trim() === '0' ? '0' : newMaxSupply;
    setTxStatus(`Setting max supply to ${value === '0' ? 'unlimited' : value + ' ' + stSymbol}…`);
    try {
      const tokenContract = await getSelectedTokenContract();
      if (!tokenContract) throw new Error('No token selected');
      const tx = await (tokenContract as ethers.Contract).setMaxSupply(
        ethers.parseUnits(value, 18)
      );
      await tx.wait();
      setTxStatus(`✓ Max supply set to ${value === '0' ? 'unlimited' : Number(value).toLocaleString() + ' ' + stSymbol}`);
      setNewMaxSupply('');
      loadInfo();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'setMaxSupply failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetMintThreshold = async () => {
    setIsSubmitting(true);
    const value = newMintThreshold.trim() === '' || newMintThreshold.trim() === '0' ? '0' : newMintThreshold;
    setTxStatus(`Setting mint threshold to ${value === '0' ? 'disabled' : value + ' ' + stSymbol}…`);
    try {
      const tokenContract = await getSelectedTokenContract();
      if (!tokenContract) throw new Error('No token selected');
      const tx = await (tokenContract as ethers.Contract).setMintThreshold(
        ethers.parseUnits(value, 18)
      );
      await tx.wait();
      setTxStatus(`✓ Mint threshold set to ${value === '0' ? 'disabled' : Number(value).toLocaleString() + ' ' + stSymbol}`);
      setNewMintThreshold('');
      loadInfo();
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'setMintThreshold failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <Coins size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Token Minting</h2>
        <p className="text-gray-400">Connect your wallet to mint and burn tokens.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Token Minting</h2>
          <p className="text-gray-400">Mint and burn security tokens ({stSymbol}) and cash tokens ({ctSymbol}).</p>
        </div>
        <button onClick={loadInfo} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          <RefreshCw size={18} className="text-gray-400" />
        </button>
      </header>

      {txStatus && (
        <div
          className={`glass-card px-4 py-3 text-sm font-medium ${
            txStatus.startsWith('✓') ? 'text-emerald-400' : txStatus.startsWith('✗') ? 'text-red-400' : 'text-purple-300'
          }`}
        >
          {txStatus}
        </div>
      )}

      {/* Token Selector */}
      {tokenOptions.length > 1 && (
        <div className="glass-card p-4">
          <label className="block text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
            <ChevronDown size={16} />
            Select Security Token
          </label>
          <select
            value={selectedTokenAddr}
            onChange={(e) => setSelectedTokenAddr(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm appearance-none cursor-pointer"
          >
            {tokenOptions.map((opt) => (
              <option key={opt.address} value={opt.address} className="bg-gray-900">
                {opt.name} ({opt.symbol}) — {opt.address.slice(0, 8)}…
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Supply Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h3 className="font-bold text-white mb-1">{stName || 'Security Token'}</h3>
          <p className="text-gray-400 text-sm mb-3">{stSymbol} · 18 decimals</p>
          <p className="text-3xl font-bold text-white">
            {Number(stSupply).toLocaleString()} <span className="text-lg text-gray-400">{stSymbol}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">Total Supply</p>
          {maxSupply > 0n && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Supply Cap Usage</span>
                <span>{Number(stSupplyRaw * 100n / maxSupply)}%</span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${
                    stSupplyRaw * 100n / maxSupply >= 90n ? 'bg-red-500' :
                    stSupplyRaw * 100n / maxSupply >= 70n ? 'bg-yellow-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Number(stSupplyRaw * 100n / maxSupply)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Cap: {Number(ethers.formatUnits(maxSupply, 18)).toLocaleString()} {stSymbol}
                {' · '}Remaining: {Number(ethers.formatUnits(maxSupply - stSupplyRaw, 18)).toLocaleString()} {stSymbol}
              </p>
            </div>
          )}
        </div>
        <div className="glass-card p-6">
          <h3 className="font-bold text-white mb-1">Tokenized HKD</h3>
          <p className="text-gray-400 text-sm mb-3">{ctSymbol} · 6 decimals</p>
          <p className="text-3xl font-bold text-white">
            {Number(ctSupply).toLocaleString()} <span className="text-lg text-gray-400">{ctSymbol}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">Total Supply</p>
        </div>
      </div>

      {/* Supply Cap & Threshold Info Bar */}
      {(maxSupply > 0n || mintThreshold > 0n) && (
        <div className="glass-card p-4 border border-purple-500/20">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} className="text-purple-400" />
            <span className="text-sm font-semibold text-purple-300">Supply Safeguards Active</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {maxSupply > 0n && (
              <div className="flex items-center gap-2 text-gray-300">
                <span className="w-2 h-2 bg-emerald-400 rounded-full" />
                <span>Max Supply: <span className="text-white font-medium">{Number(ethers.formatUnits(maxSupply, 18)).toLocaleString()}</span> {stSymbol}</span>
              </div>
            )}
            {maxSupply === 0n && (
              <div className="flex items-center gap-2 text-gray-500">
                <span className="w-2 h-2 bg-gray-600 rounded-full" />
                <span>Supply Cap: <span className="italic">Unlimited</span></span>
              </div>
            )}
            {mintThreshold > 0n && (
              <div className="flex items-center gap-2 text-gray-300">
                <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                <span>Governance Threshold: <span className="text-white font-medium">{Number(ethers.formatUnits(mintThreshold, 18)).toLocaleString()}</span> {stSymbol}</span>
              </div>
            )}
            {mintThreshold === 0n && (
              <div className="flex items-center gap-2 text-gray-500">
                <span className="w-2 h-2 bg-gray-600 rounded-full" />
                <span>Mint Threshold: <span className="italic">Disabled</span></span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Supply Safeguard Configuration (collapsible) ── */}
      <div className="glass-card border border-white/5 overflow-hidden">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-gray-400" />
            <span className="text-sm font-semibold text-gray-300">Supply Safeguard Configuration</span>
            {isTokenAdmin
              ? <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Admin</span>
              : <span className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded-full">Read-only</span>
            }
          </div>
          <ChevronDown size={16} className={`text-gray-500 transition-transform ${showConfig ? 'rotate-180' : ''}`} />
        </button>
        {showConfig && (
          <div className="px-4 pb-4 pt-0 border-t border-white/5">
            {!isTokenAdmin && (
              <div className="flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 mb-4">
                <Vote size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="text-yellow-300 font-semibold text-sm">Governance required</span>
                  <p className="text-yellow-200/70 text-xs mt-0.5">
                    Your wallet does not hold <code className="text-yellow-300">DEFAULT_ADMIN_ROLE</code> on this token.
                    To change supply safeguards, submit a governance proposal on the{' '}
                    <a href="/governance" className="underline text-yellow-300 hover:text-yellow-200">Governance page</a>.
                    The Timelock will execute the change after the 48h delay.
                  </p>
                </div>
              </div>
            )}
            <p className="text-xs text-gray-500 mb-4">
              Requires <code className="text-purple-400">DEFAULT_ADMIN_ROLE</code> on the selected security token. Set to 0 to disable.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Set Max Supply */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-400">
                  Max Supply
                  <span className="text-gray-600 ml-1">(current: {maxSupply === 0n ? 'Unlimited' : Number(ethers.formatUnits(maxSupply, 18)).toLocaleString()})</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMaxSupply}
                    onChange={(e) => setNewMaxSupply(e.target.value)}
                    placeholder={maxSupply === 0n ? 'e.g. 1000000' : Number(ethers.formatUnits(maxSupply, 18)).toString()}
                    disabled={!isTokenAdmin}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleSetMaxSupply}
                    disabled={isSubmitting || newMaxSupply.trim() === '' || !isTokenAdmin}
                    title={!isTokenAdmin ? 'Requires DEFAULT_ADMIN_ROLE — use Governance' : ''}
                    className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                    Set Cap
                  </button>
                </div>
                <p className="text-xs text-gray-600">Enter 0 to remove the cap (unlimited supply).</p>
              </div>
              {/* Set Mint Threshold */}
              <div className="space-y-2">
                <label className="block text-sm text-gray-400">
                  Mint Threshold
                  <span className="text-gray-600 ml-1">(current: {mintThreshold === 0n ? 'Disabled' : Number(ethers.formatUnits(mintThreshold, 18)).toLocaleString()})</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newMintThreshold}
                    onChange={(e) => setNewMintThreshold(e.target.value)}
                    placeholder={mintThreshold === 0n ? 'e.g. 10000' : Number(ethers.formatUnits(mintThreshold, 18)).toString()}
                    disabled={!isTokenAdmin}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                  />
                  <button
                    onClick={handleSetMintThreshold}
                    disabled={isSubmitting || newMintThreshold.trim() === '' || !isTokenAdmin}
                    title={!isTokenAdmin ? 'Requires DEFAULT_ADMIN_ROLE — use Governance' : ''}
                    className="bg-gradient-to-r from-yellow-600 to-amber-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                    Set Threshold
                  </button>
                </div>
                <p className="text-xs text-gray-600">Mints above this amount require TIMELOCK_MINTER_ROLE. Enter 0 to disable.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Security Token Mint / Burn */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          {/* Threshold warning */}
          {mintThreshold > 0n && mintAmount && (() => {
            try {
              const parsed = ethers.parseUnits(mintAmount, 18);
              if (parsed > mintThreshold) {
                return (
                  <div className="mb-3 flex items-start gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 text-sm">
                    <AlertTriangle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-yellow-300 font-semibold">Governance approval required</span>
                      <p className="text-yellow-200/70 text-xs mt-0.5">
                        Amount exceeds the {Number(ethers.formatUnits(mintThreshold, 18)).toLocaleString()} {stSymbol} threshold.
                        This mint requires <code className="text-yellow-300">TIMELOCK_MINTER_ROLE</code> (Governor → Timelock).
                      </p>
                    </div>
                  </div>
                );
              }
            } catch { /* ignore parse errors */ }
            return null;
          })()}
          {/* Cap exceeded warning */}
          {maxSupply > 0n && mintAmount && (() => {
            try {
              const parsed = ethers.parseUnits(mintAmount, 18);
              if (stSupplyRaw + parsed > maxSupply) {
                return (
                  <div className="mb-3 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm">
                    <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <span className="text-red-300 font-semibold">Exceeds supply cap</span>
                      <p className="text-red-200/70 text-xs mt-0.5">
                        Minting {mintAmount} would bring total supply to {Number(ethers.formatUnits(stSupplyRaw + parsed, 18)).toLocaleString()},
                        exceeding the {Number(ethers.formatUnits(maxSupply, 18)).toLocaleString()} cap.
                        Max mintable: {Number(ethers.formatUnits(maxSupply - stSupplyRaw, 18)).toLocaleString()} {stSymbol}.
                      </p>
                    </div>
                  </div>
                );
              }
            } catch { /* ignore parse errors */ }
            return null;
          })()}
          <TokenActionCard
            title={`Mint ${stSymbol}`}
            icon={<Plus size={20} className="text-emerald-400" />}
            addressLabel="Recipient Address"
            address={mintTo}
            onAddressChange={setMintTo}
            amount={mintAmount}
            onAmountChange={setMintAmount}
            onSubmit={handleMint}
            submitLabel="Mint Tokens"
            submitColor="from-emerald-600 to-cyan-600"
            isSubmitting={isSubmitting}
            disabled={(() => {
              if (!mintTo || !mintAmount) return true;
              try {
                const parsed = ethers.parseUnits(mintAmount, 18);
                if (maxSupply > 0n && stSupplyRaw + parsed > maxSupply) return true;
              } catch { return true; }
              return false;
            })()}
          />
        </div>
        <TokenActionCard
          title={`Burn ${stSymbol}`}
          icon={<Minus size={20} className="text-red-400" />}
          addressLabel="Burn From Address"
          address={burnFrom}
          onAddressChange={setBurnFrom}
          amount={burnAmount}
          onAmountChange={setBurnAmount}
          onSubmit={handleBurn}
          submitLabel="Burn Tokens"
          submitColor="from-red-600 to-orange-600"
          isSubmitting={isSubmitting}
        />
      </div>

      {/* Cash Token Mint / Burn */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TokenActionCard
          title={`Mint ${ctSymbol}`}
          icon={<Plus size={20} className="text-emerald-400" />}
          addressLabel="Recipient Address"
          address={cashMintTo}
          onAddressChange={setCashMintTo}
          amount={cashMintAmount}
          onAmountChange={setCashMintAmount}
          onSubmit={handleCashMint}
          submitLabel={`Mint ${ctSymbol}`}
          submitColor="from-emerald-600 to-cyan-600"
          isSubmitting={isSubmitting}
        />
        <TokenActionCard
          title={`Burn ${ctSymbol}`}
          icon={<Minus size={20} className="text-red-400" />}
          addressLabel="Burn From Address"
          address={cashBurnFrom}
          onAddressChange={setCashBurnFrom}
          amount={cashBurnAmount}
          onAmountChange={setCashBurnAmount}
          onSubmit={handleCashBurn}
          submitLabel={`Burn ${ctSymbol}`}
          submitColor="from-red-600 to-orange-600"
          isSubmitting={isSubmitting}
        />
      </div>
    </div>
  );
};

// ── Reusable Card ──

const TokenActionCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  addressLabel: string;
  address: string;
  onAddressChange: (v: string) => void;
  amount: string;
  onAmountChange: (v: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  submitColor: string;
  isSubmitting: boolean;
  disabled?: boolean;
}> = ({ title, icon, addressLabel, address, onAddressChange, amount, onAmountChange, onSubmit, submitLabel, submitColor, isSubmitting, disabled }) => (
  <div className="glass-card p-6">
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h3 className="font-bold text-white">{title}</h3>
    </div>
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-400 mb-1">{addressLabel}</label>
        <input
          type="text"
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          placeholder="0x…"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-400 mb-1">Amount</label>
        <input
          type="text"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          placeholder="0.0"
          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
        />
      </div>
      <button
        onClick={onSubmit}
        disabled={isSubmitting || !address || !amount || disabled}
        className={`w-full bg-gradient-to-r ${submitColor} text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
      >
        {isSubmitting && <Loader2 size={16} className="animate-spin" />}
        {submitLabel}
      </button>
    </div>
  </div>
);

export default TokenMinting;
