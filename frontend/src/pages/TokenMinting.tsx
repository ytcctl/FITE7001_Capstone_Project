import React, { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { Coins, Plus, Minus, RefreshCw, Loader2 } from 'lucide-react';
import { ethers } from 'ethers';

const TokenMinting: React.FC = () => {
  const { account, contracts } = useWeb3();

  // Security token
  const [stName, setStName] = useState('');
  const [stSymbol, setStSymbol] = useState('');
  const [stSupply, setStSupply] = useState('0');
  // Cash token
  const [ctSymbol, setCtSymbol] = useState('THKD');
  const [ctSupply, setCtSupply] = useState('0');

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

  const loadInfo = async () => {
    if (!contracts) return;
    try {
      const [name, sym, supply, cSym, cSupply] = await Promise.all([
        contracts.securityToken.name(),
        contracts.securityToken.symbol(),
        contracts.securityToken.totalSupply(),
        contracts.cashToken.symbol(),
        contracts.cashToken.totalSupply(),
      ]);
      setStName(name);
      setStSymbol(sym);
      setStSupply(ethers.formatUnits(supply, 18));
      setCtSymbol(cSym);
      setCtSupply(ethers.formatUnits(cSupply, 6));
    } catch (e) {
      console.error('TokenMinting load error:', e);
    }
  };

  useEffect(() => {
    loadInfo();
  }, [contracts]);

  const handleMint = async () => {
    if (!contracts || !mintTo || !mintAmount) return;
    setIsSubmitting(true);
    setTxStatus(`Minting ${mintAmount} ${stSymbol}…`);
    try {
      const tx = await contracts.securityToken.mint(mintTo, ethers.parseUnits(mintAmount, 18));
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
    if (!contracts || !burnFrom || !burnAmount) return;
    setIsSubmitting(true);
    setTxStatus(`Burning ${burnAmount} ${stSymbol}…`);
    try {
      const tx = await contracts.securityToken.burn(burnFrom, ethers.parseUnits(burnAmount, 18));
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

      {/* Supply Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h3 className="font-bold text-white mb-1">{stName || 'Security Token'}</h3>
          <p className="text-gray-400 text-sm mb-3">{stSymbol} · 18 decimals</p>
          <p className="text-3xl font-bold text-white">
            {Number(stSupply).toLocaleString()} <span className="text-lg text-gray-400">{stSymbol}</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">Total Supply</p>
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

      {/* Security Token Mint / Burn */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
        />
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
}> = ({ title, icon, addressLabel, address, onAddressChange, amount, onAmountChange, onSubmit, submitLabel, submitColor, isSubmitting }) => (
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
        disabled={isSubmitting || !address || !amount}
        className={`w-full bg-gradient-to-r ${submitColor} text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
      >
        {isSubmitting && <Loader2 size={16} className="animate-spin" />}
        {submitLabel}
      </button>
    </div>
  </div>
);

export default TokenMinting;
