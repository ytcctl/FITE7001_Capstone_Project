import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useWeb3 } from '../context/Web3Context';
import { Vote, Clock, CheckCircle, XCircle, AlertTriangle, Users, Shield, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

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

const STATE_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-100 text-yellow-800',
  Active: 'bg-blue-100 text-blue-800',
  Canceled: 'bg-gray-100 text-gray-800',
  Defeated: 'bg-red-100 text-red-800',
  Succeeded: 'bg-green-100 text-green-800',
  Queued: 'bg-purple-100 text-purple-800',
  Expired: 'bg-gray-100 text-gray-600',
  Executed: 'bg-emerald-100 text-emerald-800',
};

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

  // ─── Voting ───────────────────────────────────────────────
  const [voting, setVoting] = useState<string | null>(null);

  // ─── Status ───────────────────────────────────────────────
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // ─── Load governor configuration ─────────────────────────
  const loadGovernorInfo = useCallback(async () => {
    if (!contracts) return;
    try {
      const [name, delay, period, qNum, tlDelay] = await Promise.all([
        contracts.governor.name(),
        contracts.governor.votingDelay(),
        contracts.governor.votingPeriod(),
        contracts.governor.quorumNumerator(),
        contracts.timelock.getMinDelay(),
      ]);
      setGovName(name);
      setVotingDelay(delay);
      setVotingPeriod(period);
      setQuorumPct(qNum);
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
      // Simple proposal: transfer 0 ETH to target (or self if empty)
      const target = proposalTarget || await contracts.governor.getAddress();
      const tx = await contracts.governor.propose(
        [target],
        [0],
        ['0x'],
        proposalDescription
      );
      await tx.wait();
      setStatus({ type: 'success', message: 'Proposal created successfully!' });
      setProposalDescription('');
      setProposalTarget('');
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
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading governance data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        <Shield className="w-7 h-7 text-blue-600" />
        Governance
      </h1>

      {/* Status banner */}
      {status && (
        <div className={`p-4 rounded-lg flex items-center gap-2 ${
          status.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' :
          status.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' :
          'bg-blue-50 text-blue-800 border border-blue-200'
        }`}>
          {status.type === 'success' ? <CheckCircle className="w-5 h-5" /> :
           status.type === 'error' ? <XCircle className="w-5 h-5" /> :
           <AlertTriangle className="w-5 h-5" />}
          <span>{status.message}</span>
        </div>
      )}

      {/* Governor Config Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Governor</p>
          <p className="text-lg font-semibold">{govName}</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Voting Delay</p>
          <p className="text-lg font-semibold">{votingDelay.toString()} blocks</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Voting Period</p>
          <p className="text-lg font-semibold">{votingPeriod.toString()} blocks</p>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <p className="text-sm text-gray-500">Quorum</p>
          <p className="text-lg font-semibold">{quorumPct.toString()}% of supply</p>
        </div>
      </div>

      {/* Voting Power + Delegation */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Your Voting Power */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Vote className="w-5 h-5 text-blue-600" />
            Your Voting Power
          </h2>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-gray-600">Token Balance:</span>
              <span className="font-medium">{ethers.formatEther(tokenBalance)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Voting Power:</span>
              <span className="font-medium text-blue-600">{ethers.formatEther(votingPower)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Delegated To:</span>
              <span className="font-mono text-sm">
                {delegatee === ethers.ZeroAddress ? '(none — delegate to activate!)' :
                 delegatee === account ? '(self)' :
                 `${delegatee.slice(0, 8)}...${delegatee.slice(-6)}`}
              </span>
            </div>
            {delegatee === ethers.ZeroAddress && tokenBalance > 0n && (
              <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                <AlertTriangle className="w-4 h-4 inline mr-1" />
                You must self-delegate to activate voting power!
              </div>
            )}
          </div>
        </div>

        {/* Delegation */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            Delegate Votes
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Delegate to address</label>
              <input
                type="text"
                value={delegateAddr}
                onChange={(e) => setDelegateAddr(e.target.value)}
                placeholder="0x... or 'self'"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setDelegateAddr('self'); }}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Self
              </button>
              <button
                onClick={handleDelegate}
                disabled={delegating || !delegateAddr}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {delegating && <Loader2 className="w-4 h-4 animate-spin" />}
                Delegate
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Create Proposal */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-blue-600" />
          Create Proposal
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Description</label>
            <textarea
              value={proposalDescription}
              onChange={(e) => setProposalDescription(e.target.value)}
              placeholder="Describe the governance proposal..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Target address (optional)</label>
            <input
              type="text"
              value={proposalTarget}
              onChange={(e) => setProposalTarget(e.target.value)}
              placeholder="0x... (leave empty for signaling proposal)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button
            onClick={handlePropose}
            disabled={proposing || !proposalDescription}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {proposing && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit Proposal
          </button>
        </div>
      </div>

      {/* Proposals List */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">
          Proposals ({proposals.length})
        </h2>
        {proposals.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No proposals yet.</p>
        ) : (
          <div className="space-y-4">
            {proposals.map((p) => {
              const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
              const forPct = totalVotes > 0n ? Number((p.forVotes * 100n) / totalVotes) : 0;
              const againstPct = totalVotes > 0n ? Number((p.againstVotes * 100n) / totalVotes) : 0;
              const abstainPct = totalVotes > 0n ? Number((p.abstainVotes * 100n) / totalVotes) : 0;
              const isExpanded = expandedProposal === p.id;

              return (
                <div key={p.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${STATE_COLORS[p.stateName] || 'bg-gray-100'}`}>
                        {p.stateName}
                      </span>
                      <span className="text-sm text-gray-500">
                        ID: {p.id.slice(0, 12)}...
                      </span>
                    </div>
                    <button
                      onClick={() => setExpandedProposal(isExpanded ? null : p.id)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>
                  </div>

                  <p className="text-gray-900 font-medium mb-2">{p.description}</p>

                  {/* Vote bars */}
                  <div className="space-y-1 mb-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-16 text-green-700">For</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-3">
                        <div className="bg-green-500 h-3 rounded-full" style={{ width: `${forPct}%` }} />
                      </div>
                      <span className="w-24 text-right text-xs text-gray-500">
                        {ethers.formatEther(p.forVotes)} ({forPct}%)
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-16 text-red-700">Against</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-3">
                        <div className="bg-red-500 h-3 rounded-full" style={{ width: `${againstPct}%` }} />
                      </div>
                      <span className="w-24 text-right text-xs text-gray-500">
                        {ethers.formatEther(p.againstVotes)} ({againstPct}%)
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-16 text-gray-600">Abstain</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-3">
                        <div className="bg-gray-400 h-3 rounded-full" style={{ width: `${abstainPct}%` }} />
                      </div>
                      <span className="w-24 text-right text-xs text-gray-500">
                        {ethers.formatEther(p.abstainVotes)} ({abstainPct}%)
                      </span>
                    </div>
                  </div>

                  {/* Action buttons based on state */}
                  <div className="flex gap-2 flex-wrap">
                    {p.state === 1 && ( /* Active */
                      <>
                        <button
                          onClick={() => handleVote(p.id, 1)}
                          disabled={voting === p.id}
                          className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                        >
                          {voting === p.id ? '...' : '👍 For'}
                        </button>
                        <button
                          onClick={() => handleVote(p.id, 0)}
                          disabled={voting === p.id}
                          className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                        >
                          {voting === p.id ? '...' : '👎 Against'}
                        </button>
                        <button
                          onClick={() => handleVote(p.id, 2)}
                          disabled={voting === p.id}
                          className="px-3 py-1.5 text-sm bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-50"
                        >
                          {voting === p.id ? '...' : '🤷 Abstain'}
                        </button>
                      </>
                    )}
                    {p.state === 4 && ( /* Succeeded */
                      <button
                        onClick={() => handleQueue(p)}
                        className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded hover:bg-purple-700"
                      >
                        ⏳ Queue for Execution
                      </button>
                    )}
                    {p.state === 5 && ( /* Queued */
                      <button
                        onClick={() => handleExecute(p)}
                        className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      >
                        🚀 Execute
                      </button>
                    )}
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600 space-y-1">
                      <p><strong>Proposer:</strong> {p.proposer}</p>
                      <p><strong>Snapshot Block:</strong> {p.snapshot.toString()}</p>
                      <p><strong>Deadline Block:</strong> {p.deadline.toString()}</p>
                      <p><strong>Target(s):</strong> {p.targets.join(', ')}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Timelock info */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Timelock Configuration</h2>
        <div className="text-sm text-gray-600 space-y-1">
          <p><strong>Timelock Delay:</strong> {timelockDelay.toString()} seconds</p>
          <p><strong>Timelock Address:</strong> <span className="font-mono">{contracts?.timelock?.target?.toString()}</span></p>
          <p><strong>Governor Address:</strong> <span className="font-mono">{contracts?.governor?.target?.toString()}</span></p>
        </div>
      </div>
    </div>
  );
};

export default Governance;
