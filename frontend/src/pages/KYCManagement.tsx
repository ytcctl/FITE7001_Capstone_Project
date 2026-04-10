import React, { useState, useEffect } from 'react';
import { useWeb3 } from '../context/Web3Context';
import { CLAIM_TOPICS } from '../config/contracts';
import { ShieldCheck, UserPlus, CheckCircle, XCircle, Search, Loader2 } from 'lucide-react';

const KYCManagement: React.FC = () => {
  const { account, contracts } = useWeb3();
  // Register Identity
  const [regAddress, setRegAddress] = useState('');
  const [regCountry, setRegCountry] = useState('HK');
  // Add Claim
  const [claimAddress, setClaimAddress] = useState('');
  const [claimTopic, setClaimTopic] = useState(1);
  const [claimValue, setClaimValue] = useState(true);
  // Lookup
  const [lookupAddress, setLookupAddress] = useState('');
  const [lookupResult, setLookupResult] = useState<null | {
    registered: boolean;
    verified: boolean;
    country: string;
    claims: Record<number, boolean>;
  }>(null);
  // Status
  const [txStatus, setTxStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRegister = async () => {
    if (!contracts || !regAddress) return;
    setIsSubmitting(true);
    setTxStatus('Registering identity…');
    try {
      const tx = await contracts.identityRegistry.registerIdentity(
        regAddress,
        '0x0000000000000000000000000000000000000000',
        regCountry
      );
      setTxStatus('Transaction submitted. Waiting for confirmation…');
      await tx.wait();
      setTxStatus(`✓ Identity registered for ${regAddress.slice(0, 10)}…`);
      setRegAddress('');
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Transaction failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSetClaim = async () => {
    if (!contracts || !claimAddress) return;
    setIsSubmitting(true);
    setTxStatus(`Setting claim ${CLAIM_TOPICS[claimTopic]}…`);
    try {
      const tx = await contracts.identityRegistry.setClaim(claimAddress, claimTopic, claimValue);
      setTxStatus('Transaction submitted. Waiting for confirmation…');
      await tx.wait();
      setTxStatus(`✓ Claim "${CLAIM_TOPICS[claimTopic]}" ${claimValue ? 'set' : 'revoked'} for ${claimAddress.slice(0, 10)}…`);
    } catch (e: any) {
      setTxStatus(`✗ ${e?.reason || e?.message || 'Transaction failed'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLookup = async () => {
    if (!contracts || !lookupAddress) return;
    try {
      const [registered, verified, country] = await Promise.all([
        contracts.identityRegistry.contains(lookupAddress),
        contracts.identityRegistry.isVerified(lookupAddress),
        contracts.identityRegistry.investorCountry(lookupAddress),
      ]);
      const claims: Record<number, boolean> = {};
      for (const t of [1, 2, 3, 4, 5]) {
        claims[t] = await contracts.identityRegistry.hasClaim(lookupAddress, t);
      }
      setLookupResult({ registered, verified, country, claims });
    } catch (e: any) {
      setLookupResult(null);
      setTxStatus(`✗ Lookup failed: ${e?.reason || e?.message}`);
    }
  };

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <ShieldCheck size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">KYC Management</h2>
        <p className="text-gray-400">Connect your wallet to manage investor identities and KYC claims.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-white">KYC Management</h2>
        <p className="text-gray-400">Register identities and manage KYC/AML claims on the Identity Registry.</p>
      </header>

      {/* Status bar */}
      {txStatus && (
        <div
          className={`glass-card px-4 py-3 text-sm font-medium ${
            txStatus.startsWith('✓') ? 'text-emerald-400' : txStatus.startsWith('✗') ? 'text-red-400' : 'text-purple-300'
          }`}
        >
          {txStatus}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Register Identity ── */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserPlus size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">Register Identity</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Investor Address</label>
              <input
                type="text"
                value={regAddress}
                onChange={(e) => setRegAddress(e.target.value)}
                placeholder="0x…"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Country Code (ISO-3166)</label>
              <input
                type="text"
                value={regCountry}
                onChange={(e) => setRegCountry(e.target.value.toUpperCase())}
                maxLength={2}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <button
              onClick={handleRegister}
              disabled={isSubmitting || !regAddress}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              Register Identity
            </button>
          </div>
        </div>

        {/* ── Add / Revoke Claim ── */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle size={20} className="text-emerald-400" />
            <h3 className="font-bold text-white">Set / Revoke Claim</h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Investor Address</label>
              <input
                type="text"
                value={claimAddress}
                onChange={(e) => setClaimAddress(e.target.value)}
                placeholder="0x…"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Claim Topic</label>
              <select
                value={claimTopic}
                onChange={(e) => setClaimTopic(Number(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              >
                {Object.entries(CLAIM_TOPICS).map(([id, name]) => (
                  <option key={id} value={id} className="bg-slate-800">
                    {id} — {name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  checked={claimValue === true}
                  onChange={() => setClaimValue(true)}
                  className="accent-purple-500"
                />
                Set (active)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="radio"
                  checked={claimValue === false}
                  onChange={() => setClaimValue(false)}
                  className="accent-red-500"
                />
                Revoke
              </label>
            </div>
            <button
              onClick={handleSetClaim}
              disabled={isSubmitting || !claimAddress}
              className="w-full bg-gradient-to-r from-emerald-600 to-cyan-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 size={16} className="animate-spin" />}
              {claimValue ? 'Set Claim' : 'Revoke Claim'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Lookup ── */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Search size={20} className="text-cyan-400" />
          <h3 className="font-bold text-white">Identity Lookup</h3>
        </div>
        <div className="flex gap-3 mb-4">
          <input
            type="text"
            value={lookupAddress}
            onChange={(e) => setLookupAddress(e.target.value)}
            placeholder="Investor address 0x…"
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
          />
          <button
            onClick={handleLookup}
            className="bg-white/10 hover:bg-white/15 border border-white/10 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors"
          >
            Look Up
          </button>
        </div>
        {lookupResult && (
          <div className="bg-white/5 rounded-xl p-4 space-y-3">
            <div className="flex gap-6 text-sm">
              <span className="text-gray-400">
                Registered:{' '}
                <span className={lookupResult.registered ? 'text-emerald-400' : 'text-red-400'}>
                  {lookupResult.registered ? 'Yes' : 'No'}
                </span>
              </span>
              <span className="text-gray-400">
                Verified:{' '}
                <span className={lookupResult.verified ? 'text-emerald-400' : 'text-red-400'}>
                  {lookupResult.verified ? 'Yes' : 'No'}
                </span>
              </span>
              <span className="text-gray-400">
                Country: <span className="text-white font-medium">{lookupResult.country || '—'}</span>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(CLAIM_TOPICS).map(([id, name]) => (
                <div key={id} className="flex items-center gap-2 text-sm">
                  {lookupResult.claims[Number(id)] ? (
                    <CheckCircle size={14} className="text-emerald-400" />
                  ) : (
                    <XCircle size={14} className="text-red-400" />
                  )}
                  <span className="text-gray-300">{name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KYCManagement;
