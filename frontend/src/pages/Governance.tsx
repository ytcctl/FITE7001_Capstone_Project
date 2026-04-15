import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../context/Web3Context';
import { CONTRACT_ADDRESSES, SECURITY_TOKEN_ABI } from '../config/contracts';
import { Vote, Clock, CheckCircle, XCircle, AlertTriangle, Users, Shield, Loader2, ChevronDown, ChevronUp, RefreshCw, Plus, Play, FileText, Timer } from 'lucide-react';

// Proposal state enum (matches GovernorCountingSimple)
const PROPOSAL_STATES = [
  'Pending',    // 0
  'Active',     // 1
  'Canceled',   // 2
  'Defeated',   // 3
  'Succeeded',  // 4
  'Queued',     // 5
  'Expired',    // 6
  'Executed',   // 7
];

const STATE_COLORS: string[] = [
  'bg-amber-500/20 text-amber-400 border-amber-500/30',     // Pending
  'bg-blue-500/20 text-blue-400 border-blue-500/30',        // Active
  'bg-gray-500/20 text-gray-400 border-gray-500/30',        // Canceled
  'bg-red-500/20 text-red-400 border-red-500/30',           // Defeated
  'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', // Succeeded
  'bg-purple-500/20 text-purple-400 border-purple-500/30',  // Queued
  'bg-gray-500/20 text-gray-400 border-gray-500/30',        // Expired
  'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',        // Executed
];

interface ProposalInfo {
  id: string;
  proposer: string;
  state: number;
  stateName: string;
  snapshot: bigint;
  deadline: bigint;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  description: string;
  targets: string[];
  values: bigint[];
  calldatas: string[];
}

const Governance: React.FC = () => {
  const { contracts, account, roles } = useWeb3();

  // ─── Governor info ────────────────────────────────────────
  const [govName, setGovName] = useState('');
  const [votingDelay, setVotingDelay] = useState<bigint>(0n);
  const [votingPeriod, setVotingPeriod] = useState<bigint>(0n);
  const [quorumPct, setQuorumPct] = useState<bigint>(0n);
  const [proposalThresholdVal, setProposalThresholdVal] = useState<bigint>(0n);
  const [timelockDelay, setTimelockDelay] = useState<bigint>(0n);

  // ─── Voting power ─────────────────────────────────────────
  const [votingPower, setVotingPower] = useState<bigint>(0n);
  const [delegatee, setDelegatee] = useState('');
  const [tokenBalance, setTokenBalance] = useState<bigint>(0n);

  // ─── Delegation ───────────────────────────────────────────
  const [delegateAddr, setDelegateAddr] = useState('');
  const [delegating, setDelegating] = useState(false);

  // ─── Proposals ────────────────────────────────────────────
  const [proposals, setProposals] = useState<ProposalInfo[]>([]);
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);

  // ─── New proposal form ────────────────────────────────────
  const [proposalDescription, setProposalDescription] = useState('');
  const [proposalTarget, setProposalTarget] = useState('');
  const [proposing, setProposing] = useState(false);
  const [proposalType, setProposalType] = useState<'signaling' | 'executable'>('signaling');
  const [proposalAction, setProposalAction] = useState('mint');
  const [actionParam1, setActionParam1] = useState('');
  const [actionParam2, setActionParam2] = useState('');

  // ─── Voting ───────────────────────────────────────────────
  const [voting, setVoting] = useState<string | null>(null);

  // ─── Status ───────────────────────────────────────────────
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // ─── Load governor configuration ─────────────────────────
  const loadGovernorInfo = useCallback(async () => {
    if (!contracts) return;
    try {
      const [name, delay, period, qNum, pThresh, tlDelay] = await Promise.all([
        contracts.governor.name(),
        contracts.governor.votingDelay(),
        contracts.governor.votingPeriod(),
        contracts.governor.quorumNumerator(),
        contracts.governor.proposalThreshold(),
        contracts.timelock.getMinDelay(),
      ]);
      setGovName(name);
      setVotingDelay(delay);
      setVotingPeriod(period);
      setQuorumPct(qNum);
      setProposalThresholdVal(pThresh);
      setTimelockDelay(tlDelay);
    } catch (e) {
      console.error('Failed to load governor info:', e);
    }
  }, [contracts]);

  // ─── Load user voting info ────────────────────────────────
  const loadVotingInfo = useCallback(async () => {
    if (!contracts || !account) return;
    try {
      const [power, del, bal] = await Promise.all([
        contracts.securityToken.getVotes(account),
        contracts.securityToken.delegates(account),
        contracts.securityToken.balanceOf(account),
      ]);
      setVotingPower(power);
      setDelegatee(del);
      setTokenBalance(bal);
    } catch (e) {
      console.error('Failed to load voting info:', e);
    }
  }, [contracts, account]);

  // ─── Load proposals from events ───────────────────────────
  const loadProposals = useCallback(async () => {
    if (!contracts) return;
    try {
      const filter = contracts.governor.filters.ProposalCreated();
      const events = await contracts.governor.queryFilter(filter, 0, 'latest');
      const proposalInfos: ProposalInfo[] = [];

      for (const event of events) {
        const log = event as ethers.EventLog;
        const args = log.args;
        const proposalId = args[0].toString();
        const proposer = args[1];
        const targets = args[2];
        const values = args[3];
        const calldatas = args[5];
        const description = args[8];

        try {
          const [stateNum, snapshot, deadline, votes] = await Promise.all([
            contracts.governor.state(proposalId),
            contracts.governor.proposalSnapshot(proposalId),
            contracts.governor.proposalDeadline(proposalId),
            contracts.governor.proposalVotes(proposalId),
          ]);

          proposalInfos.push({
            id: proposalId,
            proposer,
            state: Number(stateNum),
            stateName: PROPOSAL_STATES[Number(stateNum)] || 'Unknown',
            snapshot,
            deadline,
            forVotes: votes[1],
            againstVotes: votes[0],
            abstainVotes: votes[2],
            description,
            targets,
            values,
            calldatas,
          });
        } catch {
          // Skip proposals that can't be queried
        }
      }

      setProposals(proposalInfos.reverse()); // newest first
    } catch (e) {
      console.error('Failed to load proposals:', e);
    }
  }, [contracts]);

  // ─── Initial load ─────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadGovernorInfo(), loadVotingInfo(), loadProposals()]);
      setLoading(false);
    };
    load();
  }, [loadGovernorInfo, loadVotingInfo, loadProposals]);

  // ─── Delegate ─────────────────────────────────────────────
  const handleDelegate = async () => {
    if (!contracts || !delegateAddr) return;
    setDelegating(true);
    setStatus(null);
    try {
      const addr = delegateAddr === 'self' ? account! : delegateAddr;
      const tx = await contracts.securityToken.delegate(addr);
      await tx.wait();
      setStatus({ type: 'success', message: `Delegated voting power to ${addr.slice(0, 10)}...` });
      setDelegateAddr('');
      await loadVotingInfo();
    } catch (e: any) {
      setStatus({ type: 'error', message: e.reason || e.message || 'Delegation failed' });
    } finally {
      setDelegating(false);
    }
  };

  // ─── Create proposal ─────────────────────────────────────
  const handlePropose = async () => {
    if (!contracts || !proposalDescription) return;
    setProposing(true);
    setStatus(null);
    try {
      let target: string;
      let value = 0n;
      let calldata: string;

      if (proposalType === 'executable') {
        const iface = new ethers.Interface(SECURITY_TOKEN_ABI);
        target = CONTRACT_ADDRESSES.securityToken;

        switch (proposalAction) {
          case 'mint': {
            if (!actionParam1 || !actionParam2) throw new Error('Recipient address and amount are required');
            const to = ethers.getAddress(actionParam1.trim());
            const amount = ethers.parseEther(actionParam2);
            calldata = iface.encodeFunctionData('mint', [to, amount]);
            break;
          }
          case 'burn': {
            if (!actionParam1 || !actionParam2) throw new Error('Address and amount are required');
            const from = ethers.getAddress(actionParam1.trim());
            const amount = ethers.parseEther(actionParam2);
            calldata = iface.encodeFunctionData('burn', [from, amount]);
            break;
          }
          case 'setMaxSupply': {
            if (!actionParam1) throw new Error('Max supply value is required');
            const cap = ethers.parseEther(actionParam1);
            calldata = iface.encodeFunctionData('setMaxSupply', [cap]);
            break;
          }
          case 'setMintThreshold': {
            if (!actionParam1) throw new Error('Threshold value is required');
            const threshold = ethers.parseEther(actionParam1);
            calldata = iface.encodeFunctionData('setMintThreshold', [threshold]);
            break;
          }
          case 'pause': {
            calldata = iface.encodeFunctionData('pause');
            break;
          }
          case 'unpause': {
            calldata = iface.encodeFunctionData('unpause');
            break;
          }
          default:
            throw new Error('Unknown action');
        }
      } else {
        // Signaling proposal: no on-chain action
        target = proposalTarget || await contracts.governor.getAddress();
        calldata = '0x';
      }

      const tx = await contracts.governor.propose(
        [target],
        [value],
        [calldata],
        proposalDescription
      );
      await tx.wait();
      setStatus({ type: 'success', message: 'Proposal created successfully!' });
      setProposalDescription('');
      setProposalTarget('');
      setActionParam1('');
      setActionParam2('');
      await loadProposals();
    } catch (e: any) {
      setStatus({ type: 'error', message: e.reason || e.message || 'Proposal failed' });
    } finally {
      setProposing(false);
    }
  };

  // ─── Cast vote ────────────────────────────────────────────
  const handleVote = async (proposalId: string, support: number) => {
    if (!contracts) return;
    setVoting(proposalId);
    setStatus(null);
    try {
      const tx = await contracts.governor.castVote(proposalId, support);
      await tx.wait();
      const voteLabel = support === 1 ? 'For' : support === 0 ? 'Against' : 'Abstain';
      setStatus({ type: 'success', message: `Vote cast: ${voteLabel}` });
      await loadProposals();
    } catch (e: any) {
      setStatus({ type: 'error', message: e.reason || e.message || 'Vote failed' });
    } finally {
      setVoting(null);
    }
  };

  // ─── Queue proposal ───────────────────────────────────────
  const handleQueue = async (proposal: ProposalInfo) => {
    if (!contracts) return;
    setStatus(null);
    try {
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(proposal.description));
      const tx = await contracts.governor.queue(
        proposal.targets,
        proposal.values,
        proposal.calldatas,
        descHash
      );
      await tx.wait();
      setStatus({ type: 'success', message: 'Proposal queued in Timelock!' });
      await loadProposals();
    } catch (e: any) {
      setStatus({ type: 'error', message: e.reason || e.message || 'Queue failed' });
    }
  };

  // ─── Execute proposal ─────────────────────────────────────
  const handleExecute = async (proposal: ProposalInfo) => {
    if (!contracts) return;
    setStatus(null);
    try {
      const descHash = ethers.keccak256(ethers.toUtf8Bytes(proposal.description));
      const tx = await contracts.governor.execute(
        proposal.targets,
        proposal.values,
        proposal.calldatas,
        descHash
      );
      await tx.wait();
      setStatus({ type: 'success', message: 'Proposal executed!' });
      await loadProposals();
    } catch (e: any) {
      setStatus({ type: 'error', message: e.reason || e.message || 'Execution failed' });
    }
  };

  if (loading) {
    return (
      <div className="glass-card p-12 text-center">
        <Loader2 size={48} className="mx-auto mb-4 text-purple-400 animate-spin" />
        <h2 className="text-2xl font-bold text-white mb-2">Governance</h2>
        <p className="text-gray-400">Loading governance data…</p>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="glass-card p-12 text-center">
        <Shield size={48} className="mx-auto mb-4 text-purple-400" />
        <h2 className="text-2xl font-bold text-white mb-2">Governance</h2>
        <p className="text-gray-400">Connect your wallet to participate in on-chain governance.</p>
      </div>
    );
  }

  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([loadGovernorInfo(), loadVotingInfo(), loadProposals()]);
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Governance</h2>
          <p className="text-gray-400">On-chain voting with snapshot-based governance ({govName}).</p>
        </div>
        <button onClick={refreshAll} className="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Refresh">
          <RefreshCw size={18} className="text-gray-400" />
        </button>
      </header>

      {/* Status banner */}
      {status && (
        <div
          className={`glass-card px-4 py-3 text-sm font-medium ${
            status.type === 'success' ? 'text-emerald-400' : status.type === 'error' ? 'text-red-400' : 'text-purple-300'
          }`}
        >
          {status.type === 'success' ? '✓ ' : status.type === 'error' ? '✗ ' : ''}{status.message}
        </div>
      )}

      {/* Governor Config Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={<Shield size={20} />} label="Governor" value={govName || '—'} accent="purple" />
        <StatCard icon={<Clock size={20} />} label="Voting Delay" value={`${votingDelay.toString()} blocks`} accent="cyan" />
        <StatCard icon={<Timer size={20} />} label="Voting Period" value={`${votingPeriod.toString()} blocks`} accent="amber" />
        <StatCard icon={<Users size={20} />} label="Quorum" value={`${quorumPct.toString()}% of supply`} accent="emerald" />
        <StatCard icon={<Vote size={20} />} label="Proposal Threshold" value={`${ethers.formatEther(proposalThresholdVal)} tokens`} accent="purple" />
        <StatCard icon={<Shield size={20} />} label="Identity-Locked" value="KYC Required" accent="red" />
      </div>

      {/* Voting Power + Delegation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Your Voting Power */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Vote size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">Your Voting Power</h3>
          </div>
          <dl className="space-y-3">
            <InfoRow label="Token Balance" value={ethers.formatEther(tokenBalance)} />
            <InfoRow label="Voting Power" value={ethers.formatEther(votingPower)} highlight />
            <InfoRow
              label="Delegated To"
              value={
                delegatee === ethers.ZeroAddress
                  ? '(none — delegate to activate!)'
                  : delegatee === account
                  ? '(self)'
                  : `${delegatee.slice(0, 8)}…${delegatee.slice(-6)}`
              }
            />
          </dl>
          {delegatee === ethers.ZeroAddress && tokenBalance > 0n && (
            <div className="mt-4 glass-card px-4 py-3 text-sm text-amber-400 flex items-center gap-2">
              <AlertTriangle size={16} />
              You must self-delegate to activate voting power!
            </div>
          )}
        </div>

        {/* Delegation */}
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">Delegate Votes</h3>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Delegate to address</label>
              <input
                type="text"
                value={delegateAddr}
                onChange={(e) => setDelegateAddr(e.target.value)}
                placeholder="0x… or 'self'"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDelegateAddr('self')}
                className="px-4 py-2.5 text-sm bg-white/5 border border-white/10 text-gray-300 rounded-xl hover:bg-white/10 transition-colors"
              >
                Self
              </button>
              <button
                onClick={handleDelegate}
                disabled={delegating || !delegateAddr}
                className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-4 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {delegating && <Loader2 size={16} className="animate-spin" />}
                Delegate
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Proposal */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Plus size={20} className="text-purple-400" />
          <h3 className="font-bold text-white">Create Proposal</h3>
        </div>
        <div className="space-y-3">
          {/* Proposal Type */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Proposal Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setProposalType('signaling')}
                className={`px-4 py-2 text-sm rounded-xl border transition-colors ${
                  proposalType === 'signaling'
                    ? 'bg-purple-600/30 border-purple-500/50 text-purple-300'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                }`}
              >
                Signaling
              </button>
              <button
                onClick={() => setProposalType('executable')}
                className={`px-4 py-2 text-sm rounded-xl border transition-colors ${
                  proposalType === 'executable'
                    ? 'bg-purple-600/30 border-purple-500/50 text-purple-300'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                }`}
              >
                Executable Action
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea
              value={proposalDescription}
              onChange={(e) => setProposalDescription(e.target.value)}
              placeholder="Describe the governance proposal…"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm resize-none"
            />
          </div>

          {proposalType === 'signaling' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Target address (optional)</label>
              <input
                type="text"
                value={proposalTarget}
                onChange={(e) => setProposalTarget(e.target.value)}
                placeholder="0x… (leave empty for signaling proposal)"
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
              />
            </div>
          )}

          {proposalType === 'executable' && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Action</label>
                <select
                  value={proposalAction}
                  onChange={(e) => { setProposalAction(e.target.value); setActionParam1(''); setActionParam2(''); }}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm appearance-none cursor-pointer"
                >
                  <option value="mint" className="bg-gray-900">Mint tokens (large mint via Timelock)</option>
                  <option value="burn" className="bg-gray-900">Burn tokens</option>
                  <option value="setMaxSupply" className="bg-gray-900">Set max supply cap</option>
                  <option value="setMintThreshold" className="bg-gray-900">Set mint threshold</option>
                  <option value="pause" className="bg-gray-900">Pause token transfers</option>
                  <option value="unpause" className="bg-gray-900">Unpause token transfers</option>
                </select>
              </div>

              <div className="text-xs text-gray-500 bg-white/5 rounded-xl px-4 py-2">
                Target: <span className="font-mono text-gray-400">{CONTRACT_ADDRESSES.securityToken.slice(0, 10)}…{CONTRACT_ADDRESSES.securityToken.slice(-4)}</span>
                <span className="ml-2">(HKSTPSecurityToken)</span>
              </div>

              {(proposalAction === 'mint' || proposalAction === 'burn') && (
                <>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">
                      {proposalAction === 'mint' ? 'Recipient address' : 'Address to burn from'}
                    </label>
                    <input
                      type="text"
                      value={actionParam1}
                      onChange={(e) => setActionParam1(e.target.value)}
                      placeholder="0x…"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-1">Amount (tokens)</label>
                    <input
                      type="text"
                      value={actionParam2}
                      onChange={(e) => setActionParam2(e.target.value)}
                      placeholder="e.g. 500000"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
                    />
                  </div>
                </>
              )}

              {(proposalAction === 'setMaxSupply' || proposalAction === 'setMintThreshold') && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">
                    {proposalAction === 'setMaxSupply' ? 'Max supply (tokens, 0 = unlimited)' : 'Mint threshold (tokens, 0 = disabled)'}
                  </label>
                  <input
                    type="text"
                    value={actionParam1}
                    onChange={(e) => setActionParam1(e.target.value)}
                    placeholder="e.g. 1000000"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 text-sm"
                  />
                </div>
              )}
            </>
          )}

          <button
            onClick={handlePropose}
            disabled={proposing || !proposalDescription}
            className="bg-gradient-to-r from-purple-600 to-pink-600 text-white py-2.5 px-6 rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {proposing && <Loader2 size={16} className="animate-spin" />}
            Submit Proposal
          </button>
        </div>
      </div>

      {/* Proposals List */}
      <div className="glass-card overflow-hidden">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-purple-400" />
            <h3 className="font-bold text-white">Proposals ({proposals.length})</h3>
          </div>
        </div>
        {proposals.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No proposals yet.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {proposals.map((p) => {
              const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
              const forPct = totalVotes > 0n ? Number((p.forVotes * 100n) / totalVotes) : 0;
              const againstPct = totalVotes > 0n ? Number((p.againstVotes * 100n) / totalVotes) : 0;
              const abstainPct = totalVotes > 0n ? Number((p.abstainVotes * 100n) / totalVotes) : 0;
              const isExpanded = expandedProposal === p.id;

              return (
                <div key={p.id} className="p-6 hover:bg-white/5 transition-colors">
                  {/* Header row */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATE_COLORS[p.state] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`}>
                        {p.stateName}
                      </span>
                      <span className="text-sm text-gray-500 font-mono">
                        #{p.id.slice(0, 12)}…
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedProposal(isExpanded ? null : p.id)}
                      className="p-1 hover:bg-white/10 rounded-lg transition-colors text-gray-400"
                    >
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-white font-medium mb-3 text-sm">{p.description}</p>

                  {/* Vote bars */}
                  <div className="space-y-2 mb-4">
                    <VoteBar label="For" pct={forPct} amount={ethers.formatEther(p.forVotes)} color="emerald" />
                    <VoteBar label="Against" pct={againstPct} amount={ethers.formatEther(p.againstVotes)} color="red" />
                    <VoteBar label="Abstain" pct={abstainPct} amount={ethers.formatEther(p.abstainVotes)} color="gray" />
                  </div>

                  {/* Action buttons based on state */}
                  <div className="flex gap-2 flex-wrap">
                    {p.state === 1 && ( /* Active */
                      <>
                        <button
                          onClick={() => handleVote(p.id, 1)}
                          disabled={voting === p.id}
                          className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg hover:bg-emerald-500/30 transition-colors border border-emerald-500/20 flex items-center gap-1"
                        >
                          {voting === p.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                          For
                        </button>
                        <button
                          onClick={() => handleVote(p.id, 0)}
                          disabled={voting === p.id}
                          className="text-xs bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/30 transition-colors border border-red-500/20 flex items-center gap-1"
                        >
                          {voting === p.id ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                          Against
                        </button>
                        <button
                          onClick={() => handleVote(p.id, 2)}
                          disabled={voting === p.id}
                          className="text-xs bg-gray-500/20 text-gray-400 px-3 py-1.5 rounded-lg hover:bg-gray-500/30 transition-colors border border-gray-500/20 flex items-center gap-1"
                        >
                          {voting === p.id ? <Loader2 size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
                          Abstain
                        </button>
                      </>
                    )}
                    {p.state === 4 && ( /* Succeeded */
                      <button
                        onClick={() => handleQueue(p)}
                        className="text-xs bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded-lg hover:bg-purple-500/30 transition-colors border border-purple-500/20 flex items-center gap-1"
                      >
                        <Clock size={12} />
                        Queue for Execution
                      </button>
                    )}
                    {p.state === 5 && ( /* Queued */
                      <button
                        onClick={() => handleExecute(p)}
                        className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg hover:bg-emerald-500/30 transition-colors border border-emerald-500/20 flex items-center gap-1"
                      >
                        <Play size={12} />
                        Execute
                      </button>
                    )}
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                      <DetailRow label="Proposer" value={p.proposer} mono />
                      <DetailRow label="Snapshot Block" value={p.snapshot.toString()} />
                      <DetailRow label="Deadline Block" value={p.deadline.toString()} />
                      <DetailRow label="Target(s)" value={p.targets.join(', ')} mono />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Timelock Configuration */}
      <div className="glass-card p-6">
        <div className="flex items-center gap-2 mb-4">
          <Timer size={20} className="text-purple-400" />
          <h3 className="font-bold text-white">Timelock Configuration</h3>
        </div>
        <dl className="space-y-3">
          <InfoRow label="Timelock Delay" value={`${timelockDelay.toString()}s (${(Number(timelockDelay) / 3600).toFixed(1)}h)`} />
          <InfoRow label="Proposal Threshold" value={`${ethers.formatEther(proposalThresholdVal)} tokens (1%)`} />
          <InfoRow label="Identity Requirement" value="KYC verified (live check at vote time)" />
          <InfoRow label="Timelock Address" value={contracts?.timelock?.target?.toString() || '—'} mono />
          <InfoRow label="Governor Address" value={contracts?.governor?.target?.toString() || '—'} mono />
        </dl>
      </div>
    </div>
  );
};

// ── Helper Components ──

const accentColors: Record<string, string> = {
  purple: 'text-purple-400',
  cyan: 'text-cyan-400',
  amber: 'text-amber-400',
  emerald: 'text-emerald-400',
  red: 'text-red-400',
};

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}> = ({ icon, label, value, accent }) => (
  <div className="glass-card p-6 hover:border-purple-500/30 transition-colors">
    <div className="flex items-center gap-2 mb-2">
      <span className={accentColors[accent] || 'text-gray-400'}>{icon}</span>
      <span className="text-sm text-gray-400 font-medium">{label}</span>
    </div>
    <p className="text-2xl font-bold text-white">{value}</p>
  </div>
);

const InfoRow: React.FC<{ label: string; value: string; highlight?: boolean; mono?: boolean }> = ({ label, value, highlight, mono }) => (
  <div className="flex justify-between items-center">
    <dt className="text-sm text-gray-400">{label}</dt>
    <dd className={`text-sm font-medium ${highlight ? 'text-purple-400' : 'text-white'} ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
  </div>
);

const DetailRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex justify-between items-start gap-4">
    <span className="text-xs text-gray-500 shrink-0">{label}</span>
    <span className={`text-xs text-gray-300 text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
  </div>
);

const barColors: Record<string, { bg: string; fill: string }> = {
  emerald: { bg: 'bg-emerald-500/10', fill: 'bg-emerald-500' },
  red: { bg: 'bg-red-500/10', fill: 'bg-red-500' },
  gray: { bg: 'bg-gray-500/10', fill: 'bg-gray-500' },
};

const VoteBar: React.FC<{ label: string; pct: number; amount: string; color: string }> = ({ label, pct, amount, color }) => {
  const colors = barColors[color] || barColors.gray;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`w-14 text-xs ${color === 'emerald' ? 'text-emerald-400' : color === 'red' ? 'text-red-400' : 'text-gray-400'}`}>{label}</span>
      <div className={`flex-1 ${colors.bg} rounded-full h-2.5`}>
        <div className={`${colors.fill} h-2.5 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 text-right text-xs text-gray-500">
        {amount} ({pct}%)
      </span>
    </div>
  );
};

export default Governance;
